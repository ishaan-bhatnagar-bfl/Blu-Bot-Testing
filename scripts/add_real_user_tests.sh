#!/bin/bash
# Appends real user queries (chat dump only) to blu_manual_test_cases_v1.csv
# Usage: bash ~/Desktop/BLU-Automation/scripts/add_real_user_tests.sh

python3 << 'PYEOF'
import csv, json, re
from pathlib import Path
from collections import defaultdict

BASE    = Path("/Users/ishaanbhatnagar/Desktop/BLU-Automation")
OUT_DIR = BASE / "automation/test-output"

L1_MODULE = {
    "Personal Flexi Loan":                 "Flexi_Loan_PL",
    "Flexi Loan":                          "Flexi_Loan_PL",
    "Professional & Business Flexi Loan":  "Flexi_Loan_SME",
    "Two Wheeler Loan":                    "Flexi_Wheels_TWF",
    "New Car Finance":                     "Flexi_Wheels_NCF",
    "Used Car Finance":                    "Flexi_Wheels_UCF",
    "Used Car Loan":                       "Flexi_Wheels_UCF",
    "New Tractor Loan":                    "Flexi_Wheels_NTR",
    "Used Tractor Loan":                   "Flexi_Wheels_UTR",
    "Loan Against Fixed Deposit":          "LAFD",
    "EMI Network Card":                    "EMI_Card",
    "EMI Card":                            "EMI_Card",
    "Health EMI Network Card":             "Health_EMI_Card",
    "Fixed Deposit":                       "FD_SDP",
    "SDP":                                 "FD_SDP",
    "Deposits":                            "FD_SDP",
    "FAQ Query":                           "Help_Support",
    "Agent / Human Escalation":            "Help_Support",
    "SR Status Check":                     "Help_Support",
    "SR Raise / Complaint":                "Help_Support",
    "Feedback":                            "Help_Support",
}

EXCLUDED_L0 = {"Payments","Collections, Settlement & Overdue Payments","Rewards","Insurance"}
EXCLUDED_L1 = {"BBPS / Bill Payment","Overdue Amount Query","UPI","Wallet"}

def clean_query(q):
    q = q.strip()
    if len(q) < 4: return None
    if re.match(r'^[\d\s\W]+$', q): return None
    return q

SKIP = {"hi","hello","ok","okay","thanks","thank you","yes","no","bye",
        "hii","helo","k","hmm","sure","noted","done","good","great"}

# ── PARSE CHAT DUMP ──────────────────────────────────
import openpyxl
chat_path = BASE / "data/chat_dump/Chat Dump_9_10_May.xlsx"
wb = openpyxl.load_workbook(chat_path, read_only=True, data_only=True)
ws = wb["Sheet1"]
chat_cases = []
seen = set()

for i, row in enumerate(ws.iter_rows(values_only=True)):
    if i == 0: continue
    conv = str(row[1] or "")
    turns = re.findall(r'Customer:\s*(.*?)\s*(?:\||$)', conv)
    for t in turns:
        q = clean_query(t)
        if not q: continue
        if q.lower() in SKIP: continue
        if q.lower() in seen: continue
        seen.add(q.lower())
        ql = q.lower()
        if any(x in ql for x in ["flexi","drawdown","amc","hybrid"]):
            mod = "Flexi_Loan_PL"
        elif any(x in ql for x in ["two wheeler","bike","two-wheeler"]):
            mod = "Flexi_Wheels_TWF"
        elif any(x in ql for x in ["car loan","car finance"]):
            mod = "Flexi_Wheels_NCF"
        elif any(x in ql for x in ["tractor"]):
            mod = "Flexi_Wheels_NTR"
        elif any(x in ql for x in ["emi card","insta emi","emi network"]):
            mod = "EMI_Card"
        elif any(x in ql for x in ["health emi","health card"]):
            mod = "Health_EMI_Card"
        elif any(x in ql for x in ["fixed deposit","fd ","sdp","deposit"]):
            mod = "FD_SDP"
        elif any(x in ql for x in ["lafd","loan against fd","loan against fixed"]):
            mod = "LAFD"
        else:
            mod = "Help_Support"
        chat_cases.append({
            "module":   mod,
            "l3":       "Real User Utterance",
            "question": q,
            "expected": "Bot should understand intent and respond appropriately",
            "type":     "Real_User",
            "confidence": "chat_dump",
            "source":   "chat_dump_may9_10"
        })

# ── APPEND to existing CSV ───────────────────────────
existing_path = OUT_DIR / "blu_manual_test_cases_v1.csv"

# Remap lowercase fields to titled if needed
output_path   = OUT_DIR / "blu_manual_test_cases_v2.csv"

existing = []
with open(existing_path, encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        existing.append(row)

new_rows = []
for r in chat_cases:
    new_rows.append({
        "Module":             r["module"],
        "L3":                 r["l3"],
        "Test Question":      r["question"],
        "Expected Behaviour": r["expected"],
        "In-KB or Gap":       f"Real_User ({r['source']} | conf: {r['confidence']})",
        "Pass / Fail":        ""
    })

all_rows = existing + new_rows

with open(output_path, "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=["Module","L3","Test Question","Expected Behaviour","In-KB or Gap","Pass / Fail"])
    w.writeheader()
    w.writerows(all_rows)

from collections import Counter
mod_counts = Counter(r["Module"] for r in new_rows)
print(f"\n{'='*55}")
print(f"  REAL USER TEST CASES ADDED (chat dump only)")
print(f"{'='*55}")
print(f"  From chat_dump:       {len(chat_cases)}")
print(f"  Previous test cases:  {len(existing)}")
print(f"  Total (v2):           {len(all_rows)}")
print(f"\n  {'Module':<28} {'New Cases':>10}")
print(f"  {'─'*40}")
for mod, cnt in sorted(mod_counts.items()):
    print(f"  {mod:<28} {cnt:>10}")
print(f"\n✅ Written → {output_path}")
PYEOF
