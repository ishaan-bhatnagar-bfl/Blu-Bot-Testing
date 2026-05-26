#!/bin/bash
# Step 3b — Regression Suite Builder
# Picks top 50 critical cases covering all modules
# These run on every KB update to catch regressions
# Usage: bash ~/Desktop/BLU-Automation/scripts/regression_suite.sh

python3 << 'PYEOF'
import csv, random
from pathlib import Path
from collections import defaultdict

BASE    = Path("/Users/ishaanbhatnagar/Desktop/BLU-Automation")
OUT_DIR = BASE / "automation/test-output"
IN_PATH = OUT_DIR / "blu_test_cases_v3_paraphrased.csv"

# Critical L3 categories that must always work
CRITICAL_L3 = [
    "financial transactions and actions",
    "loan foreclosure","part-prepayment","drawdown",
    "statements","fees and charges","emi related",
    "block emi card","fixed deposit details",
    "loan foreclosure","advance emi payment",
    "financial actions and transactions",
    "issues and grievances",
]

# Load In-KB rows
rows = []
with open(IN_PATH, encoding="utf-8") as f:
    for row in csv.DictReader(f):
        if row.get("In-KB or Gap") == "In-KB":
            rows.append(row)

# Group by module
by_module = defaultdict(list)
for r in rows:
    by_module[r["Module"]].append(r)

# Pick regression cases: 2-3 per module, prioritise critical L3s
regression = []
random.seed(99)

# Priority modules (your 7 scope modules + key others)
PRIORITY = [
    "Flexi_Loan_PL","Flexi_Loan_SME",
    "Flexi_Wheels_TWF","Flexi_Wheels_NCF","Flexi_Wheels_UCF",
    "Flexi_Wheels_NTR","LAFD","EMI_Card","Health_EMI_Card",
    "FD_SDP","Help_Support","Consumer_Loan","Term_Loan_PL",
    "Gold_Loan","Insurance","Business_Secured_Loan",
]

seen_q = set()
for mod in PRIORITY:
    mod_rows = by_module.get(mod, [])
    if not mod_rows: continue
    # First try critical L3
    critical = [r for r in mod_rows
                if any(l3 in (r.get("L3","") or "").lower() for l3 in CRITICAL_L3)]
    pool = critical if critical else mod_rows
    picks = random.sample(pool, min(3, len(pool)))
    for p in picks:
        if p["Test Question"].lower() not in seen_q:
            seen_q.add(p["Test Question"].lower())
            p_copy = dict(p)
            p_copy["In-KB or Gap"] = "Regression_Critical"
            regression.append(p_copy)

# Fill remaining to reach 50
if len(regression) < 50:
    remaining = [r for r in rows
                 if r["Test Question"].lower() not in seen_q]
    random.shuffle(remaining)
    for r in remaining:
        if len(regression) >= 50: break
        r_copy = dict(r)
        r_copy["In-KB or Gap"] = "Regression_Critical"
        regression.append(r_copy)
        seen_q.add(r["Test Question"].lower())

# Write
reg_path = OUT_DIR / "blu_regression_suite.csv"
fields = list(regression[0].keys())
with open(reg_path, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    w.writerows(regression)

from collections import Counter
mod_counts = Counter(r["Module"] for r in regression)
print(f"\n{'='*50}")
print(f"  REGRESSION SUITE — {len(regression)} cases")
print(f"{'='*50}")
for mod, cnt in sorted(mod_counts.items()):
    print(f"  {mod:<35} {cnt}")
print(f"\n✅ Written → {reg_path}")
PYEOF
