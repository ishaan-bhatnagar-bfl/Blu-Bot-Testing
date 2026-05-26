#!/bin/bash
# Local Paraphrase Generator
# Takes blu_test_cases_v3.csv → adds real-user-language variants per question
# No API — rule-based + template substitution
# Usage: bash ~/Desktop/BLU-Automation/scripts/paraphrase_generator.sh

python3 << 'PYEOF'
import csv, re, random
from pathlib import Path

BASE    = Path("/Users/ishaanbhatnagar/Desktop/BLU-Automation")
OUT_DIR = BASE / "automation/test-output"
IN_PATH = OUT_DIR / "blu_test_cases_v3.csv"
OUT_PATH = OUT_DIR / "blu_test_cases_v3_paraphrased.csv"

# ── PARAPHRASE RULES ─────────────────────────────────
# Each rule: (pattern, [replacements])
RULES = [
    # Formal → casual
    (r"how (do|can) i", ["how to", "how do i", "mujhe batao"]),
    (r"how (do|can) i foreclose", ["foreclose karna hai", "loan close karna hai", "loan band karna hai"]),
    (r"how (do|can) i pay( my)?", ["payment karna hai", "pay karna hai", "emi kaise bharu"]),
    (r"how (do|can) i download( my)?", ["download karna hai", "kaise download karu", "mujhe chahiye"]),
    (r"how (do|can) i check( my)?", ["kaise check karu", "dekhna hai", "check karna hai"]),
    (r"what is( my)?( the)?", ["kya hai", "batao", "details chahiye"]),
    (r"what are the", ["kya hain", "batao", "list karo"]),
    (r"i (want|would like) to", ["mujhe", "karna hai", "i need to"]),
    (r"please (help|assist|guide)", ["help karo", "guide karo", "bata do"]),
    (r"statement of account", ["soa", "account statement", "statement chahiye"]),
    (r"no dues certificate", ["ndc", "no dues chahiye", "loan clear certificate"]),
    (r"part (payment|prepayment|pre-payment)", ["part pay", "thoda paisa dena hai", "partial payment"]),
    (r"foreclose(ure)?", ["close karna", "band karna", "preclosure"]),
    (r"interest rate", ["interest kitna hai", "rate kya hai", "byaj kitna"]),
    (r"emi (amount|payment)", ["emi kitna hai", "monthly payment", "emi details"]),
    (r"bounce charge", ["bounce penalty", "emi bounce hua", "bounce fee"]),
    (r"annual maintenance charge|amc", ["amc kya hai", "yearly charge", "maintenance fee"]),
    (r"loan against fixed deposit", ["fd pe loan", "fd against loan", "lafd"]),
    (r"fixed deposit", ["fd", "fixed deposit amount", "bajaj fd"]),
    (r"drawdown", ["paise nikalna", "withdrawal", "drawdown karna"]),
    (r"block (my )?card", ["card block karo", "card band karo", "card lost"]),
    (r"activate (my )?card", ["card activate karo", "card start karo", "card chalao"]),
    (r"emi (network )?card", ["emi card", "insta emi card", "bajaj card"]),
    (r"two wheeler loan", ["bike loan", "two wheeler", "scooter loan"]),
    (r"car (finance|loan)", ["car loan", "vehicle loan", "gaadi loan"]),
    (r"tractor loan", ["tractor finance", "tractor loan bajaj"]),
    (r"flexi (hybrid|term)? ?loan", ["flexi loan", "personal loan", "pl loan"]),
    (r"raise a (service )?request", ["complaint karna hai", "sr raise karna", "request dalna hai"]),
    (r"customer care", ["helpline", "support number", "call center"]),
    (r"update (my )?mobile number", ["mobile change karna hai", "number update karo", "phone number badlna"]),
    (r"update (my )?address", ["address change karo", "address update karna", "naya address"]),
]

HINGLISH_PREFIXES = [
    "mujhe batao ", "please help ", "urgent hai - ", "kya aap bata sakte ho ",
    "i need help with ", "mere saath problem hai - ", "asap - ",
]

CASUAL_SUFFIXES = [
    "?", " please", " asap", " urgent", " help chahiye",
    " kaise karu", " bata do", " guide karo",
]

def paraphrase(question, n=3):
    """Generate n paraphrases of a question using rules."""
    q = question.strip()
    variants = set()

    # Rule-based substitutions
    for pattern, replacements in RULES:
        if re.search(pattern, q, re.IGNORECASE):
            for rep in replacements[:2]:
                new_q = re.sub(pattern, rep, q, flags=re.IGNORECASE, count=1)
                if new_q.lower() != q.lower() and len(new_q) > 4:
                    variants.add(new_q.strip().rstrip('.').strip())

    # Hinglish prefix variants
    q_core = re.sub(r'^(how (do|can) i |what is (the |my )?|please |i want to )',
                    '', q, flags=re.IGNORECASE).strip()
    if q_core and len(q_core) > 5:
        for prefix in random.sample(HINGLISH_PREFIXES, min(2, len(HINGLISH_PREFIXES))):
            variants.add(prefix + q_core.lower())

    # Short form — strip question words
    short = re.sub(r'^(how (do|can) i |what is (the |my )?|please help me |i want to )',
                   '', q, flags=re.IGNORECASE).strip()
    if short and short.lower() != q.lower() and len(short) > 5:
        variants.add(short.rstrip('?').strip())

    result = [v for v in list(variants) if v and v.lower() != q.lower()]
    return result[:n]

# ── PROCESS ──────────────────────────────────────────
rows_in = []
with open(IN_PATH, encoding="utf-8") as f:
    reader = csv.DictReader(f)
    fieldnames = reader.fieldnames
    for row in reader:
        rows_in.append(row)

rows_out = []
seen = set(r["Test Question"].lower() for r in rows_in)

for row in rows_in:
    rows_out.append(row)
    # Only paraphrase In-KB rows (not already-paraphrased variants)
    if row.get("In-KB or Gap") != "In-KB": continue
    q = row["Test Question"]
    for variant in paraphrase(q, n=2):
        if variant.lower() in seen: continue
        seen.add(variant.lower())
        new_row = row.copy()
        new_row["Test Question"] = variant
        new_row["In-KB or Gap"]  = f"Paraphrase (from: {q[:50]})"
        new_row["Pass / Fail"]   = ""
        new_row["Bot Response"]  = ""
        rows_out.append(new_row)

with open(OUT_PATH, "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
    w.writeheader()
    w.writerows(rows_out)

from collections import Counter
type_counts = Counter(r.get("In-KB or Gap","") for r in rows_out)
inkb   = sum(1 for r in rows_out if r.get("In-KB or Gap") == "In-KB")
para   = sum(1 for r in rows_out if "Paraphrase" in r.get("In-KB or Gap",""))
nat    = sum(1 for r in rows_out if "Natural_Variant" in r.get("In-KB or Gap",""))

print(f"\n{'='*55}")
print(f"  PARAPHRASE GENERATOR — SUMMARY")
print(f"{'='*55}")
print(f"  Original In-KB:     {inkb:>6}")
print(f"  Paraphrases added:  {para:>6}")
print(f"  Natural variants:   {nat:>6}")
print(f"  Total:              {len(rows_out):>6}")
print(f"\n✅ Written → {OUT_PATH}")
PYEOF
