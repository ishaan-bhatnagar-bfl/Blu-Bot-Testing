#!/bin/bash
python3 << 'PYEOF'
import csv
from pathlib import Path

OUT_DIR = Path("/Users/ishaanbhatnagar/Desktop/BLU-Automation/automation/test-output")

# Sourcing intent keywords - out of scope
SOURCING = [
    "apply for","i want a","i want an","i need a","i need an",
    "how to get","how do i get","how can i get","get a","get an",
    "apply","application","new loan","new card","open a","open an",
    "i want to apply","sign up","register","eligibility to apply",
    "documents required to get","how to apply","want to buy","want to transact"
]

# Too vague to be useful
VAGUE = [
    "help please","help","request","emi card","ok","okay",
    "yes","no","thanks","hi","hello","provide the link",
    "give me th url","whats the other process","then how we can go with your service",
    "bring your superiors to chat","you are misleading","nope network is good",
    "it's is showing as error","i can't see any options","konsi website par",
    "help ya support me ev ka query nahi aaraha hai"
]

def is_sourcing(q):
    ql = q.lower().strip()
    return any(ql.startswith(s) or s in ql for s in SOURCING)

def is_vague(q):
    ql = q.lower().strip()
    return ql in VAGUE or len(q.strip()) < 6

rows_in  = []
with open(OUT_DIR / "blu_manual_test_cases_v2.csv", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    fieldnames = reader.fieldnames
    for row in reader:
        rows_in.append(row)

removed_sourcing = []
removed_vague    = []
kept             = []

for row in rows_in:
    q    = row.get("Test Question","")
    is_ru = "Real_User" in row.get("In-KB or Gap","")
    # Only filter Real_User rows — keep all manual In-KB/Gap rows as-is
    if is_ru:
        if is_sourcing(q):
            removed_sourcing.append(q)
            continue
        if is_vague(q):
            removed_vague.append(q)
            continue
    kept.append(row)

with open(OUT_DIR / "blu_manual_test_cases_v2.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=fieldnames)
    w.writeheader()
    w.writerows(kept)

from collections import Counter
mod_counts = Counter(r["Module"] for r in kept if "Real_User" in r.get("In-KB or Gap",""))

print(f"\n{'='*55}")
print(f"  V2 CLEANUP SUMMARY")
print(f"{'='*55}")
print(f"  Removed (sourcing — out of scope): {len(removed_sourcing)}")
print(f"  Removed (too vague):               {len(removed_vague)}")
print(f"  Final total test cases:            {len(kept)}")
print(f"\n  Real user by module (kept):")
print(f"  {'Module':<28} {'Count':>6}")
print(f"  {'─'*36}")
for mod, cnt in sorted(mod_counts.items()):
    print(f"  {mod:<28} {cnt:>6}")

print(f"\n  Sourcing removed (sample):")
for q in removed_sourcing[:10]:
    print(f"    - {q[:70]}")
PYEOF
