#!/bin/bash
# BLU KB Diff Analyzer
# Usage: bash ~/Desktop/blu-automation-scripts/analyze_diff.sh

python3 << 'PYEOF'
import openpyxl, csv, json, re
from pathlib import Path
from collections import defaultdict, Counter

BASE    = Path("/Users/ishaanbhatnagar/Desktop/BLU-Automation")
OUT_DIR = BASE / "test-output"
OUT_DIR.mkdir(parents=True, exist_ok=True)

MODULE_TAG = {
    "Personal Flexi Loan":"Flexi_Loan_PL",
    "Professional & Business Flexi Loan":"Flexi_Loan_SME",
    "Two Wheeler Loan":"Flexi_Wheels_TWF",
    "New Car Finance":"Flexi_Wheels_NCF",
    "Used Car Loan":"Flexi_Wheels_UCF",
    "New Tractor Loan":"Flexi_Wheels_NTR",
    "Used Tractor Loan":"Flexi_Wheels_UTR",
    "Tractor Loan":"Flexi_Wheels_TR",
    "Loan Against Fixed Deposit":"LAFD",
    "Loan against Fixed deposit":"LAFD",
    "EMI Network Card":"EMI_Card",
    "Health EMI Network Card":"Health_EMI_Card",
    "Fixed Deposit":"FD_SDP","SDP":"FD_SDP",
    "GenericDepositQueries":"FD_SDP","Deposits":"FD_SDP",
    "Help on Raising a Request":"Help_Support",
    "Document Centre":"Help_Support","CIBIL":"Help_Support",
    "KYC":"Help_Support","Mandate":"Help_Support",
    "Key Fact Statement":"Help_Support","Profile Services":"Help_Support",
}

SCOPE_MODULES = set(MODULE_TAG.values())

# ── LOAD EXCEL KBs ───────────────────────────────────
excel_rows = []
excel_q_map = {}  # lowercase q → row

wb1 = openpyxl.load_workbook(BASE / "knowledge_base/Excels/Vaibhav Deshmukh/KR_Sheet_BLU.xlsx", read_only=True, data_only=True)
for i, row in enumerate(wb1["Sheet1"].iter_rows(values_only=True)):
    if i == 0: continue
    l1,l2,l3 = str(row[0] or ""), str(row[1] or ""), str(row[2] or "")
    q,ans,flag = str(row[3] or "").strip(), str(row[4] or ""), str(row[5] or "")
    mod = MODULE_TAG.get(l2, "")
    if q:
        r = {"source":"KR_Sheet","l1":l1,"l2":l2,"l3":l3,"question":q,"answer":ans,"chatbot_flag":flag,"module":mod}
        excel_rows.append(r)
        excel_q_map[q.lower()] = r

wb2 = openpyxl.load_workbook(BASE / "knowledge_base/Excels/Vaibhav Deshmukh/RAR & FAQ_Help & Support.xlsx", read_only=True, data_only=True)
for i, row in enumerate(wb2["Sheet1"].iter_rows(values_only=True)):
    if i == 0: continue
    l1,l2,l3 = str(row[0] or ""), str(row[1] or ""), str(row[2] or "")
    q    = str(row[30] or "").strip()
    ans  = str(row[31] or "")
    flag = str(row[32] or "")
    mod  = MODULE_TAG.get(l2, "")
    if q:
        r = {"source":"RAR_FAQ","l1":l1,"l2":l2,"l3":l3,"question":q,"answer":ans,"chatbot_flag":flag,"module":mod}
        excel_rows.append(r)
        excel_q_map[q.lower()] = r

# ── LOAD MAY 22 JSONs ────────────────────────────────
json_rows = []
json_q_map = {}

for f in sorted((BASE / "knowledge_base/JSONs/May 22 - Latest Content").glob("*.json")):
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        if not isinstance(data, list): data = [data]
        for item in data:
            l2  = item.get("l2category") or item.get("L2Category") or ""
            mod = MODULE_TAG.get(l2)
            if not mod: continue
            q   = (item.get("question") or item.get("Question") or "").strip()
            ans = item.get("answer") or item.get("Answer") or ""
            l3  = item.get("l3category") or item.get("L3Category") or ""
            if q:
                r = {"module":mod,"l2":l2,"l3":l3,"question":q,"answer":ans,"source_file":f.name}
                json_rows.append(r)
                json_q_map[q.lower()] = r
    except: pass

# ── DIFF ─────────────────────────────────────────────
excel_only = [r for r in excel_rows if r["question"].lower() not in json_q_map and r["module"] in SCOPE_MODULES]
json_only  = [r for r in json_rows  if r["question"].lower() not in excel_q_map]
matched    = [r for r in excel_rows if r["question"].lower() in json_q_map and r["module"] in SCOPE_MODULES]

# ── WRITE: Excel-only (needs JSON update) ────────────
excel_only_path = OUT_DIR / "gaps_excel_not_in_json.csv"
fields = ["module","source","l1","l2","l3","question","answer","chatbot_flag"]
with open(excel_only_path, "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    for r in sorted(excel_only, key=lambda x: (x["module"], x["l3"])):
        w.writerow(r)

# ── WRITE: JSON-only (newer content / not in Excel) ──
json_only_path = OUT_DIR / "gaps_json_not_in_excel.csv"
fields2 = ["module","l2","l3","question","source_file"]
with open(json_only_path, "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=fields2, extrasaction="ignore")
    w.writeheader()
    for r in sorted(json_only, key=lambda x: (x["module"], x["l3"])):
        w.writerow(r)

# ── SUMMARY by module ────────────────────────────────
print(f"\n{'='*65}")
print(f"  KB DIFF SUMMARY — Excel vs May 22 JSONs (Scope modules only)")
print(f"{'='*65}")
print(f"\n{'Module':<25} {'Matched':>8} {'Excel-only':>11} {'JSON-only':>10}")
print("─" * 57)

all_mods = sorted(SCOPE_MODULES)
for mod in all_mods:
    m = sum(1 for r in matched    if r["module"] == mod)
    e = sum(1 for r in excel_only if r["module"] == mod)
    j = sum(1 for r in json_only  if r["module"] == mod)
    if m+e+j > 0:
        print(f"{mod:<25} {m:>8} {e:>11} {j:>10}")

print("─" * 57)
print(f"{'TOTAL':<25} {len(matched):>8} {len(excel_only):>11} {len(json_only):>10}")

# ── REAL USER: scope-filtered ────────────────────────
SCOPE_L0 = {"Loan", "Cards", "Deposits", "Help & Support"}
pilot_path = BASE / "data/chat_dump/phase3_pilot_output.csv"
scoped_queries = []
with open(pilot_path, encoding="utf-8", errors="ignore") as f:
    reader = csv.DictReader(f)
    for row in reader:
        q   = row.get("question_clean","").strip()
        l0  = row.get("L0","")
        l1  = row.get("L1","")
        l2  = row.get("L2","")
        conf= row.get("confidence","")
        # Filter to scope L0s only, exclude collections/payments
        if l0 in SCOPE_L0 and "collection" not in l1.lower() and "payment" not in l1.lower():
            in_kb = q.lower() in json_q_map or q.lower() in excel_q_map
            scoped_queries.append({
                "question":q,"L0":l0,"L1":l1,"L2":l2,
                "confidence":conf,"in_kb":"Yes" if in_kb else "No"
            })

real_scoped_path = OUT_DIR / "real_user_scoped.csv"
with open(real_scoped_path, "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=["question","L0","L1","L2","confidence","in_kb"])
    w.writeheader()
    w.writerows(scoped_queries)

not_in_kb = [r for r in scoped_queries if r["in_kb"] == "No"]
print(f"\n{'='*65}")
print(f"  REAL USER QUERIES (scope modules only)")
print(f"{'='*65}")
print(f"  Total scoped:        {len(scoped_queries)}")
print(f"  Found in KB:         {len(scoped_queries) - len(not_in_kb)}")
print(f"  NOT in KB (gaps):    {len(not_in_kb)}")
print(f"\n  Top 20 real user gaps (not in KB):")
print(f"  {'Query':<50} {'L1':<30} {'Conf'}")
print("  " + "─"*90)
for r in not_in_kb[:20]:
    print(f"  {r['question'][:50]:<50} {r['L1'][:30]:<30} {r['confidence']}")

print(f"\n✅ Files written:")
print(f"   {excel_only_path}")
print(f"   {json_only_path}")
print(f"   {real_scoped_path}")
PYEOF
