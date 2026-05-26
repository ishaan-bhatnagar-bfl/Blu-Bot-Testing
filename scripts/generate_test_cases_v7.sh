#!/bin/bash
# BLU Test Case Generator v7 — Sophisticated Python equivalent of v6.js
# Features:
#   - Utterance → KB keyword overlap scoring (0-100 confidence)
#   - Cross-module reject rules
#   - Gap-fill for L3s with zero utterance coverage
#   - Max 50 per L2, balanced
#   - Sources: May 22 JSONs + Apr chat dump + Loan KR xlsx
# Usage: bash ~/Desktop/BLU-Automation/scripts/generate_test_cases_v7.sh

python3 << 'PYEOF'
import json, csv, re, openpyxl
from pathlib import Path
from collections import defaultdict, Counter

BASE     = Path("/Users/ishaanbhatnagar/Desktop/BLU-Automation")
JSON_DIR = BASE / "knowledge_base/JSONs/May 22 - Latest Content"
LOAN_KR  = BASE / "knowledge_base/Excels/Vikas Rathour/Loan Knowledge Repository version-1.1.xlsx"
APR_DUMP = BASE / "data/chat_dump/Chat Dump_2_Apr.xlsx"
OUT_DIR  = BASE / "automation/test-output"
OUT_DIR.mkdir(parents=True, exist_ok=True)

MAX_PER_L2       = 50
LOW_CONF_THRESH  = 25

# ── MODULE MAP ────────────────────────────────────────
MODULE_MAP = {
    "Personal Flexi Loan":                        "Flexi_Loan_PL",
    "Professional & Business Flexi Loan":         "Flexi_Loan_SME",
    "Personal Term Loan":                         "Term_Loan_PL",
    "Professional & Business Term Loan":          "Term_Loan_SME",
    "Consumer Loan":                              "Consumer_Loan",
    "Business Secured Loan":                      "Business_Secured_Loan",
    "Microfinance Group Loan":                    "Microfinance",
    "Gold Loan":                                  "Gold_Loan",
    "Home Loan":                                  "Home_Loan",
    "Loan Against Securities":                    "LAS",
    "Loans Against Securities":                   "LAS",
    "Two Wheeler Loan":                           "Flexi_Wheels_TWF",
    "New Car Finance":                            "Flexi_Wheels_NCF",
    "Used Car Loan":                              "Flexi_Wheels_UCF",
    "New Tractor Loan":                           "Flexi_Wheels_NTR",
    "Used Tractor Loan":                          "Flexi_Wheels_UTR",
    "Loan Against Fixed Deposit":                 "LAFD",
    "Loan against Fixed deposit":                 "LAFD",
    "Loan Payment Services":                      "Loan_Payments",
    "EMI Network Card":                           "EMI_Card",
    "Health EMI Network Card":                    "Health_EMI_Card",
    "Bajaj Finance DBS Co-branded Credit Card":   "Credit_Card_DBS",
    "Bajaj Finance RBL Co-branded Credit Card":   "Credit_Card_RBL",
    "Bajaj Finance RBL Bank Co-branded Credit Card": "Credit_Card_RBL",
    "Fixed Deposit":                              "FD_SDP",
    "SDP":                                        "FD_SDP",
    "GenericDepositQueries":                      "FD_SDP",
    "Insurance Services":                         "Insurance",
    "Help on Raising a Request":                  "Help_Support",
    "Document Centre":                            "Help_Support",
    "CIBIL":                                      "Help_Support",
    "KYC":                                        "Help_Support",
    "Mandate":                                    "Help_Support",
    "Key Fact Statement":                         "Help_Support",
    "Profile Services":                           "Help_Support",
    "GenericDNCQueries":                          "Help_Support",
    "GenericLoanQueries":                         "Generic_Loan",
    "GenericCardsQueries":                        "Generic_Cards",
    "GenericInsuranceQueries":                    "Generic_Insurance",
    "BBPS":                                       "BBPS",
    "GenericBBPSQueries":                         "BBPS",
    "Bill Payments":                              "Bill_Payments",
    "Bank Transfer":                              "Wallet",
    "Cashback":                                   "Wallet",
    "Topup":                                      "Wallet",
    "Wallet To Wallet Transfer Debit":            "Wallet",
    "GenericWalletsQueries":                      "Wallet",
    "P2M":                                        "UPI",
    "P2P":                                        "UPI",
    "Interop P2M":                                "UPI",
    "Interop P2P":                                "UPI",
    "GenericUpiQueries":                          "UPI",
    "Online Merchant":                            "UPI",
    "fastag":                                     "FASTag",
    "GenericfastagQueries":                       "FASTag",
    "Gift card":                                  "Gift_Card",
    "Earn":                                       "Rewards",
    "Earn Rewards":                               "Rewards",
    "Burn":                                       "Rewards",
    "Redeem Rewards":                             "Rewards",
    "General":                                    "Rewards",
}

# Cross-module reject rules — if utterance contains these, reject for this module
REJECT_RULES = {
    "EMI_Card": ["gold loan","home loan","car loan","tractor","two wheeler","bike","personal loan","flexi"],
    "Flexi_Loan_PL": ["emi card","insta emi","health card","tractor","car loan","two wheeler"],
    "FD_SDP": ["loan","emi card","insurance","upi","wallet"],
    "LAFD": ["emi card","insurance","upi","wallet","car loan","two wheeler","tractor"],
    "Help_Support": [],  # no rejects — catch-all
}

def strip_html(text):
    return re.sub(r'<[^>]+>', ' ', text or '').strip()

def tokenize(text):
    return set(re.findall(r'\b[a-z]{3,}\b', text.lower()))

STOPWORDS = {'the','and','for','that','this','with','have','from','your','what',
             'how','can','will','does','you','are','not','but','its','been',
             'they','when','also','more','about','bajaj','finserv','finance'}

def keywords(text):
    return tokenize(text) - STOPWORDS

def overlap_score(utterance_kw, kb_kw):
    if not kb_kw: return 0
    return round(len(utterance_kw & kb_kw) / len(kb_kw) * 100)

def should_reject(utterance, module):
    ul = utterance.lower()
    for reject_kw in REJECT_RULES.get(module, []):
        if reject_kw in ul:
            return True
    return False

# ── LOAD KB FROM JSONs ────────────────────────────────
print("Loading KB from JSONs...")
kb_items = []  # {l2, l3, module, question, answer, q_kw}
for f in sorted(JSON_DIR.glob("*.json")):
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        if not isinstance(data, list): data = [data]
        for item in data:
            l2  = item.get("l2category") or item.get("L2Category") or ""
            l3  = item.get("l3category") or item.get("L3Category") or ""
            q   = (item.get("question") or item.get("Question") or "").strip()
            ans = strip_html(item.get("answer") or item.get("Answer") or "")
            mod = MODULE_MAP.get(l2)
            if not mod or not q: continue
            kb_items.append({
                "l2": l2, "l3": l3, "module": mod,
                "question": q, "answer": ans[:200],
                "q_kw": keywords(q)
            })
    except: pass
print(f"  KB items loaded: {len(kb_items):,}")

# ── LOAD UTTERANCES FROM APR DUMP ─────────────────────
print("Loading utterances from Apr chat dump...")
QNA_MODULE_MAP = {**MODULE_MAP}  # reuse same map
utterances = []  # {text, module, l3, confidence_base}

wb = openpyxl.load_workbook(APR_DUMP, read_only=True, data_only=True)
ws = wb["Edited Sheet"]
rows_iter = ws.iter_rows(values_only=True)
headers = [str(h).strip() if h else '' for h in next(rows_iter)]
q_idx   = headers.index("question")
qna_idx = headers.index("q_n_a_Category")
prod_idx = headers.index("product_category")

seen_u = set()
for i, row in enumerate(rows_iter):
    if i >= 150000: break
    q = str(row[q_idx] or '').strip()
    if not q or len(q) < 5 or q.lower() in seen_u: continue
    if re.match(r'^[\d\s\W]+$', q): continue
    seen_u.add(q.lower())
    qna  = str(row[qna_idx] or '').strip()
    prod = str(row[prod_idx] or '').strip()
    mod  = MODULE_MAP.get(qna) or MODULE_MAP.get(prod)
    if mod:
        utterances.append({"text": q, "module": mod, "l3": qna or prod, "kw": keywords(q)})

print(f"  Utterances loaded: {len(utterances):,}")

# ── MATCH UTTERANCES → KB QUESTIONS ──────────────────
print("Scoring utterance → KB keyword overlap...")

# Group KB by module
kb_by_mod = defaultdict(list)
for item in kb_items:
    kb_by_mod[item["module"]].append(item)

# Group utterances by module
utt_by_mod = defaultdict(list)
for u in utterances:
    utt_by_mod[u["module"]].append(u)

# For each module: match utterances to best KB question
results = []
l3_coverage = defaultdict(set)  # module → set of L3s covered by utterances

for mod, kb_list in kb_by_mod.items():
    utt_list = utt_by_mod.get(mod, [])
    l2_counts = Counter()

    # Score each utterance against KB
    scored = []
    for u in utt_list:
        if should_reject(u["text"], mod): continue
        best_score = 0
        best_kb = None
        for kb in kb_list:
            sc = overlap_score(u["kw"], kb["q_kw"])
            if sc > best_score:
                best_score = sc
                best_kb = kb
        if best_score >= LOW_CONF_THRESH and best_kb:
            scored.append((best_score, u, best_kb))
            l3_coverage[mod].add(best_kb["l3"])

    # Sort by confidence desc, cap at MAX_PER_L2 per L2
    scored.sort(key=lambda x: -x[0])
    l2_seen = Counter()
    for score, u, kb in scored:
        l2 = kb["l2"]
        if l2_seen[l2] >= MAX_PER_L2: continue
        l2_seen[l2] += 1
        results.append({
            "Type":             "Service",
            "Module":           mod,
            "L2":               l2,
            "L3":               kb["l3"],
            "Test Question":    u["text"],
            "Matched KB Q":     kb["question"],
            "Expected Behaviour": kb["answer"],
            "Confidence":       score,
            "Chatbot Flag":     "yes",
            "In-KB or Gap":     f"Utterance_Matched (conf:{score})",
            "Pass / Fail":      "",
            "Bot Response":     "",
            "Source File":      "generate_v7",
        })

print(f"  Utterance-matched: {len(results):,}")

# ── GAP FILL: L3s with zero utterance coverage ────────
print("Gap-filling uncovered L3s with KB verbatim...")
gap_filled = 0
for mod, kb_list in kb_by_mod.items():
    covered_l3s = l3_coverage[mod]
    l3_kb = defaultdict(list)
    for kb in kb_list:
        l3_kb[kb["l3"]].append(kb)
    for l3, items in l3_kb.items():
        if l3 in covered_l3s: continue
        # Add up to 3 KB questions verbatim for uncovered L3
        for kb in items[:3]:
            results.append({
                "Type":             "Service",
                "Module":           mod,
                "L2":               kb["l2"],
                "L3":               l3,
                "Test Question":    kb["question"],
                "Matched KB Q":     kb["question"],
                "Expected Behaviour": kb["answer"],
                "Confidence":       100,
                "Chatbot Flag":     "yes",
                "In-KB or Gap":     "In-KB (L3_GapFill)",
                "Pass / Fail":      "",
                "Bot Response":     "",
                "Source File":      "generate_v7",
            })
            gap_filled += 1

print(f"  Gap-filled: {gap_filled:,}")
total = len(results)
print(f"  Total v7 cases: {total:,}")

# ── WRITE ─────────────────────────────────────────────
out_path = OUT_DIR / "blu_test_cases_v7.csv"
fields = ["Type","Module","L2","L3","Test Question","Matched KB Q",
          "Expected Behaviour","Confidence","Chatbot Flag","In-KB or Gap",
          "Pass / Fail","Bot Response","Source File"]
with open(out_path, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    w.writerows(results)

# ── SUMMARY ───────────────────────────────────────────
mod_counts = Counter(r["Module"] for r in results)
conf_dist  = Counter("high" if r["Confidence"]>=70 else "med" if r["Confidence"]>=40 else "low"
                     for r in results)

print(f"\n{'='*60}")
print(f"  BLU TEST CASES v7 — SUMMARY")
print(f"{'='*60}")
print(f"\n  Utterance-matched:  {total-gap_filled:>7,}")
print(f"  L3 gap-filled:      {gap_filled:>7,}")
print(f"  Total:              {total:>7,}")
print(f"\n  Confidence distribution:")
print(f"    High (>=70):  {conf_dist['high']:>6,}")
print(f"    Med  (>=40):  {conf_dist['med']:>6,}")
print(f"    Low  (<40):   {conf_dist['low']:>6,}")
print(f"\n  Top modules:")
print(f"  {'Module':<30} {'Count':>7}")
print(f"  {'─'*39}")
for mod, cnt in sorted(mod_counts.items(), key=lambda x:-x[1])[:20]:
    print(f"  {mod:<30} {cnt:>7,}")
print(f"\n✅ Written → {out_path}")
PYEOF
