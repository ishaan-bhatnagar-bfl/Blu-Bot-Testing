#!/bin/bash
# BLU Manual Test Case Extractor v2
# Usage: bash ~/Downloads/extract_questions.sh
# Output: ~/Desktop/BLU-Automation/automation/test-output/

python3 << 'PYEOF'
import json, os, csv, re
from pathlib import Path
from collections import Counter

json_dir = Path(os.path.expanduser("~/Desktop/BLU-Automation/knowledge_base/JSONs/May 22 - Latest Content"))
out_dir  = Path(os.path.expanduser("~/Desktop/BLU-Automation/automation/test-output"))
out_dir.mkdir(parents=True, exist_ok=True)

# Exact L2 values from source → module tag
MODULE_TAG = {
    # Flexi Loan PL
    "Personal Flexi Loan":                    "Flexi_Loan_PL",
    # Flexi Loan SME
    "Professional & Business Flexi Loan":     "Flexi_Loan_SME",
    # Wheels
    "Two Wheeler Loan":                       "Flexi_Wheels_TWF",
    "New Car Finance":                        "Flexi_Wheels_NCF",
    "Used Car Loan":                          "Flexi_Wheels_UCF",
    "New Tractor Loan":                       "Flexi_Wheels_NTR",
    "Used Tractor Loan":                      "Flexi_Wheels_UTR",
    "Tractor Loan":                           "Flexi_Wheels_TR",
    # LAFD
    "Loan Against Fixed Deposit":             "LAFD",
    "Loan against Fixed deposit":             "LAFD",
    # EMI Card
    "EMI Network Card":                       "EMI_Card",
    # Health EMI Card
    "Health EMI Network Card":                "Health_EMI_Card",
    # FD / SDP
    "Fixed Deposit":                          "FD_SDP",
    "SDP":                                    "FD_SDP",
    "GenericDepositQueries":                  "FD_SDP",
    "Deposits":                               "FD_SDP",
    "Systematic Deposit":                     "FD_SDP",
    # Help & Support (all Others subcategories)
    "Help on Raising a Request":              "Help_Support",
    "Document Centre":                        "Help_Support",
    "CIBIL":                                  "Help_Support",
    "KYC":                                    "Help_Support",
    "Mandate":                                "Help_Support",
    "Key Fact Statement":                     "Help_Support",
    "Profile Services":                       "Help_Support",
}

def strip_html(text):
    return re.sub(r'<[^>]+>', ' ', text or '').strip()

records = []
skipped = []

for f in sorted(json_dir.glob("*.json")):
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            data = [data]
        for item in data:
            l2   = item.get("l2category") or item.get("L2Category") or ""
            mod  = MODULE_TAG.get(l2)
            if not mod:
                continue
            q    = (item.get("question") or item.get("Question") or "").strip()
            ans  = strip_html(item.get("answer") or item.get("Answer") or "")[:200]
            l3   = item.get("l3category") or item.get("L3Category") or ""
            flag = item.get("chatbot-flag", "yes")
            if q:
                records.append({
                    "module":       mod,
                    "l2":           l2,
                    "l3":           l3,
                    "question":     q,
                    "answer_hint":  ans,
                    "chatbot_flag": flag,
                    "source_file":  f.name,
                })
    except Exception as e:
        skipped.append(f"{f.name}: {e}")

fields = ["module","l2","l3","question","answer_hint","chatbot_flag","source_file"]

with open(out_dir / "blu_manual_test_cases.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=fields)
    w.writeheader()
    w.writerows(records)

with open(out_dir / "blu_manual_test_cases.json", "w", encoding="utf-8") as fh:
    json.dump(records, fh, indent=2, ensure_ascii=False)

counts = Counter(r["module"] for r in records)
print(f"\n✅ Extracted {len(records)} questions")
print(f"📁 Output → {out_dir}\n")
print(f"{'Module':<30} {'Count':>6}")
print("─" * 38)
for mod, cnt in sorted(counts.items()):
    print(f"{mod:<30} {cnt:>6}")
if skipped:
    print(f"\n⚠️  Skipped {len(skipped)} files:")
    for s in skipped:
        print(f"   {s}")
PYEOF
