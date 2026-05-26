#!/bin/bash
# BLU Test Case Generator v3
# Generates comprehensive test cases from May 22 JSONs
# Includes: Service + Sourcing + all modules + real user language variants
# Usage: bash ~/Desktop/BLU-Automation/scripts/generate_test_cases_v3.sh

python3 << 'PYEOF'
import json, csv, re, os
from pathlib import Path
from collections import defaultdict

BASE     = Path("/Users/ishaanbhatnagar/Desktop/BLU-Automation")
JSON_DIR = BASE / "knowledge_base/JSONs/May 22 - Latest Content"
OUT_DIR  = BASE / "automation/test-output"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── MODULE MAP ───────────────────────────────────────
MODULE_MAP = {
    "Personal Flexi Loan":                        ("Flexi_Loan_PL",         "Service"),
    "Professional & Business Flexi Loan":         ("Flexi_Loan_SME",        "Service"),
    "Personal Term Loan":                         ("Term_Loan_PL",          "Service"),
    "Professional & Business Term Loan":          ("Term_Loan_SME",         "Service"),
    "Consumer Loan":                              ("Consumer_Loan",         "Service"),
    "Business Secured Loan":                      ("Business_Secured_Loan", "Service"),
    "Microfinance Group Loan":                    ("Microfinance",          "Service"),
    "Gold Loan":                                  ("Gold_Loan",             "Service"),
    "Home Loan":                                  ("Home_Loan",             "Service"),
    "Loan Against Securities":                    ("LAS",                   "Service"),
    "Loans Against Securities":                   ("LAS",                   "Service"),
    "Two Wheeler Loan":                           ("Flexi_Wheels_TWF",      "Service"),
    "New Car Finance":                            ("Flexi_Wheels_NCF",      "Service"),
    "Used Car Loan":                              ("Flexi_Wheels_UCF",      "Service"),
    "New Tractor Loan":                           ("Flexi_Wheels_NTR",      "Service"),
    "Used Tractor Loan":                          ("Flexi_Wheels_UTR",      "Service"),
    "Loan Against Fixed Deposit":                 ("LAFD",                  "Service"),
    "Loan against Fixed deposit":                 ("LAFD",                  "Service"),
    "Loan Payment Services":                      ("Loan_Payments",         "Service"),
    "EMI Network Card":                           ("EMI_Card",              "Service"),
    "Health EMI Network Card":                    ("Health_EMI_Card",       "Service"),
    "Bajaj Finance DBS Co-branded Credit Card":   ("Credit_Card_DBS",       "Service"),
    "Bajaj Finance RBL Co-branded Credit Card":   ("Credit_Card_RBL",       "Service"),
    "Bajaj Finance RBL Bank Co-branded Credit Card": ("Credit_Card_RBL",    "Service"),
    "Fixed Deposit":                              ("FD_SDP",                "Service"),
    "SDP":                                        ("FD_SDP",                "Service"),
    "GenericDepositQueries":                      ("FD_SDP",                "Service"),
    "Insurance Services":                         ("Insurance",             "Service"),
    "Help on Raising a Request":                  ("Help_Support",          "Service"),
    "Document Centre":                            ("Help_Support",          "Service"),
    "CIBIL":                                      ("Help_Support",          "Service"),
    "KYC":                                        ("Help_Support",          "Service"),
    "Mandate":                                    ("Help_Support",          "Service"),
    "Key Fact Statement":                         ("Help_Support",          "Service"),
    "Profile Services":                           ("Help_Support",          "Service"),
    "GenericDNCQueries":                          ("Help_Support",          "Service"),
    "GenericLoanQueries":                         ("Generic_Loan",          "Service"),
    "GenericCardsQueries":                        ("Generic_Cards",         "Service"),
    "GenericInsuranceQueries":                    ("Generic_Insurance",     "Service"),
    "BBPS":                                       ("BBPS",                  "Payments"),
    "GenericBBPSQueries":                         ("BBPS",                  "Payments"),
    "Bill Payments":                              ("Bill_Payments",         "Payments"),
    "Bank Transfer":                              ("Wallet",                "Payments"),
    "Cashback":                                   ("Wallet",                "Payments"),
    "Topup":                                      ("Wallet",                "Payments"),
    "Wallet To Wallet Transfer Debit":            ("Wallet",                "Payments"),
    "GenericWalletsQueries":                      ("Wallet",                "Payments"),
    "P2M":                                        ("UPI",                   "Payments"),
    "P2P":                                        ("UPI",                   "Payments"),
    "Interop P2M":                                ("UPI",                   "Payments"),
    "Interop P2P":                                ("UPI",                   "Payments"),
    "GenericUpiQueries":                          ("UPI",                   "Payments"),
    "Online Merchant":                            ("UPI",                   "Payments"),
    "fastag":                                     ("FASTag",                "Payments"),
    "GenericfastagQueries":                       ("FASTag",                "Payments"),
    "Gift card":                                  ("Gift_Card",             "Payments"),
    "Earn":                                       ("Rewards",               "Rewards"),
    "Earn Rewards":                               ("Rewards",               "Rewards"),
    "Burn":                                       ("Rewards",               "Rewards"),
    "Redeem Rewards":                             ("Rewards",               "Rewards"),
    "General":                                    ("Rewards",               "Rewards"),
}

SOURCING_L3 = {"apply for emi network card","apply for loan against fixed deposit",
               "application related","apply","eligibility","new loan","insta emi card apply",
               "apply for card","apply for loan","sourcing"}

def is_sourcing(l3):
    l3l = l3.lower().strip()
    return any(k in l3l for k in SOURCING_L3)

def strip_html(text):
    return re.sub(r'<[^>]+>', ' ', text or '').strip()

def natural_variants(question, l3):
    """Generate 2-3 natural language variants of a formal KB question locally."""
    q = question.strip().rstrip('?')
    variants = []

    # Variant 1: short/casual
    q_lower = q.lower()
    short = q
    for formal, casual in [
        ("how do i", "how to"),
        ("how can i", "how to"),
        ("what is the process to", "how to"),
        ("what is the procedure to", "steps to"),
        ("i would like to", "i want to"),
        ("please provide", "give me"),
        ("kindly", ""),
        ("my bajaj finance", "my"),
        ("bajaj finance", "bajaj"),
        ("bajaj finserv", "bajaj"),
    ]:
        short = short.replace(formal, casual).replace(formal.title(), casual.title())
    variants.append(short.strip())

    # Variant 2: frustrated/urgent user
    urgent_prefixes = {
        "foreclose": "i want to close my",
        "foreclosure": "i want to close my",
        "part payment": "i want to part pay my",
        "part-prepayment": "part pay karna hai",
        "drawdown": "paise nikalna hai",
        "statement": "statement chahiye",
        "noc": "noc chahiye mujhe",
        "bounce": "bounce ho gaya emi",
        "emi": "mera emi",
        "interest": "interest rate kya hai",
        "block": "card block karna hai",
        "activate": "card activate karna hai",
    }
    for kw, prefix in urgent_prefixes.items():
        if kw in q_lower:
            variants.append(prefix)
            break

    # Variant 3: question form
    if not q.endswith('?'):
        variants.append(q + '?')

    return [v for v in variants if v and v != question][:2]

# ── LOAD & PROCESS ───────────────────────────────────
records = []
seen_q = set()

for f in sorted(JSON_DIR.glob("*.json")):
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        if not isinstance(data, list): data = [data]
        for item in data:
            l2   = item.get("l2category") or item.get("L2Category") or ""
            l3   = item.get("l3category") or item.get("L3Category") or ""
            q    = (item.get("question") or item.get("Question") or "").strip()
            ans  = strip_html(item.get("answer") or item.get("Answer") or "")[:300]
            flag = str(item.get("chatbot-flag","yes")).lower()

            if not q or q.lower() in seen_q: continue
            seen_q.add(q.lower())

            mapping = MODULE_MAP.get(l2)
            if not mapping: continue
            module, base_type = mapping

            # Determine Service vs Sourcing
            type_ = "Sourcing" if is_sourcing(l3) else base_type

            # Expected behaviour
            expected = ans[:150] if ans else "Bot should provide accurate information with CTA"

            records.append({
                "Type":               type_,
                "Module":             module,
                "L2":                 l2,
                "L3":                 l3,
                "Test Question":      q,
                "Natural Variant 1":  "",
                "Natural Variant 2":  "",
                "Expected Behaviour": expected,
                "Chatbot Flag":       flag,
                "In-KB or Gap":       "In-KB",
                "Pass / Fail":        "",
                "Bot Response":       "",
                "Source File":        f.name,
            })

            # Generate natural variants
            variants = natural_variants(q, l3)
            for i, v in enumerate(variants):
                if v.lower() in seen_q: continue
                seen_q.add(v.lower())
                r = records[-1].copy()
                r["Test Question"]     = v
                r["Natural Variant 1"] = ""
                r["Natural Variant 2"] = ""
                r["In-KB or Gap"]      = f"Natural_Variant (from: {q[:50]})"
                records.append(r)

    except Exception as e:
        print(f"ERR {f.name}: {e}")

# ── WRITE CSV ────────────────────────────────────────
out_path = OUT_DIR / "blu_test_cases_v3.csv"
fields = ["Type","Module","L2","L3","Test Question","Expected Behaviour",
          "Chatbot Flag","In-KB or Gap","Pass / Fail","Bot Response","Source File"]

with open(out_path, "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    w.writerows(records)

# ── SUMMARY ──────────────────────────────────────────
from collections import Counter
type_counts  = Counter(r["Type"] for r in records)
mod_counts   = Counter(r["Module"] for r in records)
inkb_counts  = Counter(r["In-KB or Gap"] for r in records)

print(f"\n{'='*60}")
print(f"  BLU TEST CASES v3 — SUMMARY")
print(f"{'='*60}")
print(f"\n  Total test cases: {len(records)}")
print(f"\n  By Type:")
for t, c in sorted(type_counts.items()):
    print(f"    {t:<20} {c:>6}")

print(f"\n  By Module (top 20):")
print(f"  {'Module':<30} {'Count':>6}")
print(f"  {'─'*38}")
for mod, cnt in sorted(mod_counts.items(), key=lambda x: -x[1])[:20]:
    print(f"  {mod:<30} {cnt:>6}")

print(f"\n  In-KB vs Natural Variants:")
inkb = sum(1 for r in records if r["In-KB or Gap"] == "In-KB")
nat  = sum(1 for r in records if "Natural_Variant" in r["In-KB or Gap"])
print(f"    In-KB:             {inkb:>6}")
print(f"    Natural Variants:  {nat:>6}")

print(f"\n✅ Written → {out_path}")
PYEOF
