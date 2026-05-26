#!/usr/bin/env python3
"""
BLU Bot — Results Aggregation Script
Input:  Exported results CSV from dashboard (drag-drop or --input flag)
Output: HTML report + CSV summary → ~/Desktop/BLU-Automation/automation/test-output/reports/

Dashboard CSV expected columns (case-insensitive, flexible):
  Module, Question/User_Message, Bot_Response/Response, Status/Result,
  Score/Auto_Score, Type (auto/manual), Timestamp
"""

import csv
import sys
import os
import re
import json
import argparse
from datetime import datetime
from collections import defaultdict
from pathlib import Path

OUT_DIR = Path.home() / "Desktop/BLU-Automation/automation/test-output/reports"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── Column aliases ────────────────────────────────────────────────────────────
COL_ALIASES = {
    "module":    ["module", "mod"],
    "question":  ["question", "user_message", "utterance", "input", "query"],
    "response":  ["bot_response", "response", "answer", "bot_answer"],
    "status":    ["status", "result", "pass_fail", "verdict"],
    "score":     ["score", "auto_score", "confidence"],
    "type":      ["type", "run_type", "test_type"],
    "timestamp": ["timestamp", "time", "date"],
}

def resolve_cols(headers: list[str]) -> dict:
    h_lower = [h.strip().lower() for h in headers]
    resolved = {}
    for field, aliases in COL_ALIASES.items():
        for alias in aliases:
            if alias in h_lower:
                resolved[field] = h_lower.index(alias)
                break
    return resolved

def get(row, col_map, field, default=""):
    idx = col_map.get(field)
    if idx is None or idx >= len(row):
        return default
    return row[idx].strip()

def is_pass(status: str) -> bool:
    return status.lower() in ("pass", "passed", "p", "true", "1", "yes")

def is_fail(status: str) -> bool:
    return status.lower() in ("fail", "failed", "f", "false", "0", "no")

def is_auto(type_val: str) -> bool:
    return "auto" in type_val.lower()

# ── Parse CSV ─────────────────────────────────────────────────────────────────
def parse_csv(path: str) -> tuple[dict, list]:
    """Returns (module_stats, all_rows_dicts)"""
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        headers = next(reader)
        col_map = resolve_cols(headers)

        if "module" not in col_map:
            print(f"[WARN] No 'module' column found. Headers: {headers}")
        if "status" not in col_map:
            sys.exit("[ERR] No status/result column. Cannot aggregate.")

        module_stats = defaultdict(lambda: {
            "total": 0, "pass": 0, "fail": 0,
            "auto_pass": 0, "auto_fail": 0, "skip": 0,
            "failures": []
        })

        all_rows = []
        for row in reader:
            if not any(row):
                continue
            module  = get(row, col_map, "module", "Unknown").strip() or "Unknown"
            question= get(row, col_map, "question")
            response= get(row, col_map, "response")
            status  = get(row, col_map, "status")
            score   = get(row, col_map, "score")
            type_v  = get(row, col_map, "type", "manual")
            ts      = get(row, col_map, "timestamp")

            s = module_stats[module]
            s["total"] += 1

            passed = is_pass(status)
            failed = is_fail(status)
            auto   = is_auto(type_v)

            if passed:
                s["pass"] += 1
                if auto: s["auto_pass"] += 1
            elif failed:
                s["fail"] += 1
                if auto: s["auto_fail"] += 1
                s["failures"].append({
                    "question": question,
                    "response": response,
                    "score":    score,
                    "ts":       ts
                })
            else:
                s["skip"] += 1

            all_rows.append({
                "module": module, "question": question,
                "response": response, "status": status,
                "score": score, "type": type_v, "ts": ts
            })

    return dict(module_stats), all_rows

# ── Top N failures (global) ───────────────────────────────────────────────────
def top_failures(module_stats: dict, n=10) -> list:
    all_fails = []
    for mod, s in module_stats.items():
        for f in s["failures"]:
            all_fails.append({**f, "module": mod})
    # Sort: lowest score first (worst), fallback alpha
    def sort_key(f):
        try: return float(f["score"])
        except: return 999
    all_fails.sort(key=sort_key)
    return all_fails[:n]

# ── CSV summary ───────────────────────────────────────────────────────────────
def write_csv(module_stats: dict, date_str: str):
    path = OUT_DIR / f"summary_{date_str}.csv"
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Module","Total","Pass","Fail","Auto_Pass","Auto_Fail","Skip","Pass_Rate_%"])
        totals = [0,0,0,0,0,0]
        for mod, s in sorted(module_stats.items()):
            rate = round(s["pass"]/s["total"]*100, 1) if s["total"] else 0
            w.writerow([mod, s["total"], s["pass"], s["fail"],
                        s["auto_pass"], s["auto_fail"], s["skip"], rate])
            totals[0] += s["total"]; totals[1] += s["pass"]; totals[2] += s["fail"]
            totals[3] += s["auto_pass"]; totals[4] += s["auto_fail"]; totals[5] += s["skip"]
        total_rate = round(totals[1]/totals[0]*100,1) if totals[0] else 0
        w.writerow(["TOTAL", *totals, total_rate])
    return path

# ── HTML report ───────────────────────────────────────────────────────────────
def pct_color(rate: float) -> str:
    if rate >= 80: return "#22c55e"
    if rate >= 60: return "#f59e0b"
    return "#ef4444"

def write_html(module_stats: dict, top_fails: list, source_file: str, date_str: str):
    path = OUT_DIR / f"report_{date_str}.html"

    rows_html = ""
    grand = [0,0,0,0,0,0]
    for mod, s in sorted(module_stats.items()):
        rate = round(s["pass"]/s["total"]*100, 1) if s["total"] else 0
        color = pct_color(rate)
        rows_html += f"""
        <tr>
          <td>{mod}</td>
          <td>{s['total']}</td>
          <td class="pass">{s['pass']}</td>
          <td class="fail">{s['fail']}</td>
          <td>{s['auto_pass']}</td>
          <td>{s['auto_fail']}</td>
          <td>{s['skip']}</td>
          <td style="color:{color};font-weight:700">{rate}%</td>
        </tr>"""
        grand[0]+=s['total']; grand[1]+=s['pass']; grand[2]+=s['fail']
        grand[3]+=s['auto_pass']; grand[4]+=s['auto_fail']; grand[5]+=s['skip']

    total_rate = round(grand[1]/grand[0]*100,1) if grand[0] else 0
    tc = pct_color(total_rate)
    rows_html += f"""
        <tr class="total-row">
          <td>TOTAL</td><td>{grand[0]}</td>
          <td class="pass">{grand[1]}</td><td class="fail">{grand[2]}</td>
          <td>{grand[3]}</td><td>{grand[4]}</td><td>{grand[5]}</td>
          <td style="color:{tc};font-weight:800">{total_rate}%</td>
        </tr>"""

    fails_html = ""
    for i, f in enumerate(top_fails, 1):
        q  = f["question"] or "—"
        r  = (f["response"] or "—")[:300]
        sc = f["score"] or "—"
        mod= f["module"]
        ts = f["ts"] or "—"
        fails_html += f"""
        <tr>
          <td>{i}</td>
          <td><span class="badge">{mod}</span></td>
          <td>{q}</td>
          <td>{r}{"…" if len(f.get("response",""))>300 else ""}</td>
          <td>{sc}</td>
          <td>{ts}</td>
        </tr>"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>BLU Bot Test Report — {date_str}</title>
<style>
  :root{{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--sub:#94a3b8;
        --pass:#22c55e;--fail:#ef4444;--warn:#f59e0b;--accent:#6366f1}}
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{background:var(--bg);color:var(--text);font:14px/1.5 'Inter',system-ui,sans-serif;padding:32px}}
  h1{{font-size:22px;font-weight:700;margin-bottom:4px}}
  .meta{{color:var(--sub);font-size:12px;margin-bottom:28px}}
  h2{{font-size:15px;font-weight:600;color:var(--sub);text-transform:uppercase;
      letter-spacing:.08em;margin:28px 0 12px}}
  .card{{background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden}}
  table{{width:100%;border-collapse:collapse}}
  th{{background:#0f172a;color:var(--sub);font-size:11px;text-transform:uppercase;
      letter-spacing:.06em;padding:10px 14px;text-align:left;border-bottom:1px solid var(--border)}}
  td{{padding:10px 14px;border-bottom:1px solid var(--border);vertical-align:top;font-size:13px}}
  tr:last-child td{{border-bottom:none}}
  tr:hover td{{background:rgba(99,102,241,.06)}}
  .pass{{color:var(--pass)}} .fail{{color:var(--fail)}}
  .total-row td{{background:rgba(99,102,241,.1);font-weight:700}}
  .badge{{background:#334155;color:#94a3b8;font-size:10px;padding:2px 8px;
          border-radius:99px;white-space:nowrap}}
  .kpi-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:28px}}
  .kpi{{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 20px}}
  .kpi-val{{font-size:28px;font-weight:800;line-height:1}}
  .kpi-lbl{{font-size:11px;color:var(--sub);margin-top:4px;text-transform:uppercase;letter-spacing:.06em}}
</style>
</head>
<body>
<h1>BLU Bot — Test Results Report</h1>
<div class="meta">Generated: {date_str.replace('_',' ')} &nbsp;|&nbsp; Source: {os.path.basename(source_file)}</div>

<div class="kpi-grid">
  <div class="kpi"><div class="kpi-val">{grand[0]}</div><div class="kpi-lbl">Total Tests</div></div>
  <div class="kpi"><div class="kpi-val" style="color:var(--pass)">{grand[1]}</div><div class="kpi-lbl">Pass</div></div>
  <div class="kpi"><div class="kpi-val" style="color:var(--fail)">{grand[2]}</div><div class="kpi-lbl">Fail</div></div>
  <div class="kpi"><div class="kpi-val" style="color:{tc}">{total_rate}%</div><div class="kpi-lbl">Pass Rate</div></div>
  <div class="kpi"><div class="kpi-val">{grand[3]}</div><div class="kpi-lbl">Auto-Pass</div></div>
  <div class="kpi"><div class="kpi-val" style="color:var(--fail)">{grand[4]}</div><div class="kpi-lbl">Auto-Fail</div></div>
</div>

<h2>Module Summary</h2>
<div class="card">
<table>
  <thead><tr>
    <th>Module</th><th>Total</th><th>Pass</th><th>Fail</th>
    <th>Auto-Pass</th><th>Auto-Fail</th><th>Skip</th><th>Pass Rate</th>
  </tr></thead>
  <tbody>{rows_html}</tbody>
</table>
</div>

<h2>Top 10 Failures</h2>
<div class="card">
<table>
  <thead><tr>
    <th>#</th><th>Module</th><th>Question</th><th>Bot Response</th><th>Score</th><th>Timestamp</th>
  </tr></thead>
  <tbody>{fails_html if fails_html else '<tr><td colspan="6" style="color:var(--pass);text-align:center;padding:20px">No failures 🎉</td></tr>'}</tbody>
</table>
</div>

</body></html>"""

    path.write_text(html, encoding="utf-8")
    return path

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="BLU Bot results aggregator")
    parser.add_argument("input", nargs="?", help="Path to exported results CSV")
    args = parser.parse_args()

    if args.input:
        csv_path = args.input
    else:
        # Auto-discover: newest CSV in test-output that isn't a known generated file
        search_dir = Path.home() / "Desktop/BLU-Automation/automation/test-output"
        skip_patterns = ["summary_", "kb_diff_", "blu_test_cases", "blu_regression",
                         "blu_edge", "blu_multiturn"]
        candidates = [
            f for f in search_dir.glob("*.csv")
            if not any(p in f.name for p in skip_patterns)
        ]
        if not candidates:
            sys.exit("[ERR] No results CSV found. Pass path as argument: python3 aggregate_results.py <file.csv>")
        csv_path = str(max(candidates, key=lambda f: f.stat().st_mtime))
        print(f"[AUTO] Using: {csv_path}")

    date_str = datetime.now().strftime("%Y-%m-%d_%H%M")
    print(f"[PARSE] {csv_path}")

    module_stats, all_rows = parse_csv(csv_path)
    top_fails = top_failures(module_stats)

    csv_out  = write_csv(module_stats, date_str)
    html_out = write_html(module_stats, top_fails, csv_path, date_str)

    print(f"\n[DONE]")
    print(f"  HTML  → {html_out}")
    print(f"  CSV   → {csv_out}")
    print(f"\n[SUMMARY]")

    grand = [0,0,0,0]
    for mod, s in sorted(module_stats.items()):
        rate = round(s["pass"]/s["total"]*100,1) if s["total"] else 0
        print(f"  {mod:<30} {s['total']:>4} total | {s['pass']:>3} pass | {s['fail']:>3} fail | {rate:>5}%")
        grand[0]+=s['total']; grand[1]+=s['pass']; grand[2]+=s['fail']
    total_rate = round(grand[1]/grand[0]*100,1) if grand[0] else 0
    print(f"  {'TOTAL':<30} {grand[0]:>4} total | {grand[1]:>3} pass | {grand[2]:>3} fail | {total_rate:>5}%")

if __name__ == "__main__":
    main()
