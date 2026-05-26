#!/usr/bin/env python3
"""
BLU Bot — KB Update Trigger
Watches knowledge_base/JSONs/ for new folders.
On detection: runs extract → v3 generator → paraphrase → v7 generator → diffs vs master CSV.
Outputs: kb_diff_YYYY-MM-DD.csv in test-output/

Usage:
  # One-shot (point at new folder explicitly):
  python3 kb_update_trigger.py --new-folder "May 22 - Latest Content"

  # Auto-detect newest folder vs previous:
  python3 kb_update_trigger.py --auto

  # Watch mode (polls every 60s):
  python3 kb_update_trigger.py --watch [--interval 60]
"""

import os
import sys
import csv
import json
import time
import shutil
import hashlib
import argparse
import subprocess
from datetime import datetime
from pathlib import Path

# ── CONFIG — edit these paths if structure differs ────────────────────────────
BASE        = Path.home() / "Desktop/BLU-Automation"
KB_JSONS    = BASE / "knowledge_base/JSONs"
SCRIPTS_DIR = BASE / "scripts"
TEST_OUT    = BASE / "automation/test-output"
REPORTS_DIR = TEST_OUT / "reports"

MASTER_CSV  = TEST_OUT / "blu_test_cases_v3_paraphrased.csv"
V7_CSV      = TEST_OUT / "blu_test_cases_v7.csv"

# Script filenames (must live in SCRIPTS_DIR)
SCRIPT_EXTRACT   = "extract_questions.py"        # or .js
SCRIPT_GEN_V3    = "generate_test_cases_v3.py"
SCRIPT_PARAPHRASE= "paraphrase_generator.py"
SCRIPT_GEN_V7    = "generate_test_cases_v7.py"

POLL_INTERVAL = 60   # seconds for --watch mode

# ── Helpers ───────────────────────────────────────────────────────────────────

def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")

def folder_hash(folder: Path) -> str:
    """Stable hash of all JSON file sizes+names in a folder."""
    h = hashlib.md5()
    for f in sorted(folder.glob("*.json")):
        h.update(f.name.encode())
        h.update(str(f.stat().st_size).encode())
    return h.hexdigest()

def list_kb_folders() -> list[Path]:
    """Return all subfolders of KB_JSONS sorted by mtime."""
    if not KB_JSONS.exists():
        return []
    folders = [f for f in KB_JSONS.iterdir() if f.is_dir()]
    return sorted(folders, key=lambda f: f.stat().st_mtime)

def newest_folder() -> Path | None:
    folders = list_kb_folders()
    return folders[-1] if folders else None

def previous_folder(current: Path) -> Path | None:
    folders = list_kb_folders()
    idx = next((i for i, f in enumerate(folders) if f == current), None)
    if idx is None or idx == 0:
        return None
    return folders[idx - 1]

# ── Script runner ─────────────────────────────────────────────────────────────

def run_script(script_name: str, env_overrides: dict = None) -> bool:
    """Run a script from SCRIPTS_DIR. Supports .py and .js."""
    script_path = SCRIPTS_DIR / script_name
    if not script_path.exists():
        log(f"[WARN] Script not found: {script_path} — skipping")
        return False

    env = os.environ.copy()
    if env_overrides:
        env.update({k: str(v) for k, v in env_overrides.items()})

    ext = script_path.suffix.lower()
    if ext == ".py":
        cmd = [sys.executable, str(script_path)]
    elif ext == ".js":
        node = shutil.which("node") or shutil.which("node18") or "node"
        cmd = [node, str(script_path)]
    else:
        log(f"[ERR] Unknown script type: {ext}")
        return False

    log(f"  → Running: {script_name}")
    result = subprocess.run(cmd, env=env, capture_output=False)
    if result.returncode != 0:
        log(f"  [FAIL] {script_name} exited {result.returncode}")
        return False
    log(f"  [OK] {script_name}")
    return True

def run_pipeline(new_folder: Path) -> bool:
    """Run the 4-script pipeline against new_folder."""
    log(f"Pipeline start → {new_folder.name}")
    env = {"KB_FOLDER": str(new_folder)}

    steps = [
        (SCRIPT_EXTRACT,    env),
        (SCRIPT_GEN_V3,     env),
        (SCRIPT_PARAPHRASE, env),
        (SCRIPT_GEN_V7,     env),
    ]

    for script, e in steps:
        ok = run_script(script, e)
        if not ok:
            log(f"[ABORT] Pipeline stopped at {script}")
            return False

    log("Pipeline complete.")
    return True

# ── Diff logic ────────────────────────────────────────────────────────────────

def load_csv_questions(path: Path) -> dict[str, str]:
    """
    Returns {question_lower → answer} from a test-case CSV.
    Flexible column detection.
    """
    if not path.exists():
        return {}

    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        try:
            headers = [h.strip().lower() for h in next(reader)]
        except StopIteration:
            return {}

        def find(aliases):
            for a in aliases:
                if a in headers: return headers.index(a)
            return None

        q_idx = find(["question","utterance","user_message","input","query"])
        a_idx = find(["expected_answer","answer","bot_response","response","expected"])

        if q_idx is None:
            log(f"[WARN] No question column in {path.name}")
            return {}

        result = {}
        for row in reader:
            if len(row) <= q_idx: continue
            q = row[q_idx].strip().lower()
            a = row[a_idx].strip() if a_idx and a_idx < len(row) else ""
            if q:
                result[q] = a
        return result

def diff_csvs(old_path: Path, new_path: Path, date_str: str) -> Path:
    """
    Diffs two test-case CSVs. Outputs kb_diff_YYYY-MM-DD.csv.
    Columns: Change_Type, Question, Old_Answer, New_Answer, Notes
    """
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = TEST_OUT / f"kb_diff_{date_str}.csv"

    log(f"Diffing: {old_path.name} vs {new_path.name}")
    old = load_csv_questions(old_path)
    new = load_csv_questions(new_path)

    old_keys = set(old.keys())
    new_keys = set(new.keys())

    added   = new_keys - old_keys
    removed = old_keys - new_keys
    common  = old_keys & new_keys
    changed = {k for k in common if old[k].strip() != new[k].strip()}

    log(f"  Added:   {len(added)}")
    log(f"  Removed: {len(removed)}")
    log(f"  Changed: {len(changed)}")
    log(f"  Unchanged: {len(common) - len(changed)}")

    rows = []

    for q in sorted(added):
        rows.append({
            "Change_Type": "ADDED",
            "Question":    q,
            "Old_Answer":  "",
            "New_Answer":  new[q][:500],
            "Notes":       "New question in updated KB"
        })

    for q in sorted(removed):
        rows.append({
            "Change_Type": "REMOVED",
            "Question":    q,
            "Old_Answer":  old[q][:500],
            "New_Answer":  "",
            "Notes":       "Question removed from updated KB"
        })

    for q in sorted(changed):
        old_a = old[q]
        new_a = new[q]
        # Rough change magnitude
        if len(new_a) == 0:
            note = "Answer cleared"
        elif abs(len(new_a) - len(old_a)) > 100:
            note = "Major answer change"
        else:
            note = "Minor answer change"
        rows.append({
            "Change_Type": "CHANGED",
            "Question":    q,
            "Old_Answer":  old_a[:500],
            "New_Answer":  new_a[:500],
            "Notes":       note
        })

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["Change_Type","Question","Old_Answer","New_Answer","Notes"])
        w.writeheader()
        w.writerows(rows)

    log(f"Diff saved → {out_path}")
    return out_path

# ── Snapshot store (for watch mode) ──────────────────────────────────────────

SNAPSHOT_FILE = TEST_OUT / ".kb_snapshot.json"

def load_snapshot() -> dict:
    if SNAPSHOT_FILE.exists():
        return json.loads(SNAPSHOT_FILE.read_text())
    return {}

def save_snapshot(data: dict):
    TEST_OUT.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_FILE.write_text(json.dumps(data, indent=2))

# ── Modes ─────────────────────────────────────────────────────────────────────

def run_once(new_folder: Path, skip_pipeline: bool = False):
    date_str = datetime.now().strftime("%Y-%m-%d")

    if not skip_pipeline:
        ok = run_pipeline(new_folder)
        if not ok:
            log("[ERR] Pipeline failed. Diff will still run against existing CSVs.")

    # Diff: v7 CSV (freshest) vs master
    new_csv = V7_CSV if V7_CSV.exists() else None
    old_csv = MASTER_CSV if MASTER_CSV.exists() else None

    if not new_csv:
        log("[WARN] V7 CSV not found — diff skipped. Run pipeline first.")
        return

    if not old_csv:
        log("[WARN] Master CSV not found — cannot diff. Only new CSV exists.")
        return

    diff_path = diff_csvs(old_csv, new_csv, date_str)
    log(f"\nDone. Diff report: {diff_path}")

def run_auto():
    folders = list_kb_folders()
    if len(folders) < 2:
        log("[ERR] Need at least 2 KB folders to auto-diff. Use --new-folder instead.")
        sys.exit(1)

    new_folder = folders[-1]
    log(f"Detected newest folder: {new_folder.name}")
    run_once(new_folder)

def run_watch(interval: int):
    log(f"Watch mode — polling every {interval}s. Ctrl+C to stop.")
    snapshot = load_snapshot()

    while True:
        new_folder = newest_folder()
        if new_folder:
            fh = folder_hash(new_folder)
            key = str(new_folder)
            if snapshot.get(key) != fh:
                log(f"Change detected: {new_folder.name}")
                run_once(new_folder)
                snapshot[key] = fh
                save_snapshot(snapshot)
            else:
                log(f"No change in {new_folder.name}")
        else:
            log("No KB folders found.")

        time.sleep(interval)

# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="BLU KB Update Trigger")
    group  = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--new-folder", metavar="FOLDER_NAME",
                       help="Name of new KB folder under knowledge_base/JSONs/")
    group.add_argument("--auto",   action="store_true",
                       help="Auto-detect newest folder in KB_JSONS")
    group.add_argument("--watch",  action="store_true",
                       help="Poll for new folders and trigger on change")
    group.add_argument("--diff-only", action="store_true",
                       help="Skip pipeline, just diff existing CSVs")

    parser.add_argument("--interval", type=int, default=POLL_INTERVAL,
                        help=f"Poll interval in seconds (default {POLL_INTERVAL})")

    args = parser.parse_args()

    TEST_OUT.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    if args.new_folder:
        folder = KB_JSONS / args.new_folder
        if not folder.exists():
            sys.exit(f"[ERR] Folder not found: {folder}")
        run_once(folder)

    elif args.auto:
        run_auto()

    elif args.watch:
        run_watch(args.interval)

    elif args.diff_only:
        log("Diff-only mode — skipping pipeline.")
        run_once(newest_folder() or Path("."), skip_pipeline=True)

if __name__ == "__main__":
    main()
