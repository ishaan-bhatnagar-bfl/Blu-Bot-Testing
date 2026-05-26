#!/bin/bash
# Step 3 — Edge Case Generator
# Generates stress-test queries: typos, truncated, Hinglish, emotional, mixed script
# Usage: bash ~/Desktop/BLU-Automation/scripts/edge_case_generator.sh

python3 << 'PYEOF'
import csv, re, random
from pathlib import Path
from collections import Counter

BASE    = Path("/Users/ishaanbhatnagar/Desktop/BLU-Automation")
OUT_DIR = BASE / "automation/test-output"
IN_PATH = OUT_DIR / "blu_test_cases_v3_paraphrased.csv"

# Load In-KB rows only as source
source = []
with open(IN_PATH, encoding="utf-8") as f:
    for row in csv.DictReader(f):
        if row.get("In-KB or Gap") == "In-KB":
            source.append(row)

print(f"Source In-KB rows: {len(source):,}")

# ── TYPO ENGINE ────────────────────────────────────
TYPOS = {
    "foreclose":"forclose","foreclosure":"forclousure","interest":"intrest",
    "statement":"statment","payment":"paymnet","account":"accout",
    "balance":"balence","certificate":"certifcate","outstanding":"outstandng",
    "charges":"chrages","download":"downlaod","activate":"actvate",
    "transaction":"transacton","flexi":"flexy","drawdown":"drawdwon",
    "prepayment":"prepayemnt","mandate":"mandat","nominee":"nominne",
    "maturity":"maturty","deposit":"deposite","insurance":"insurence",
    "eligibility":"eligiblity","documents":"documets","application":"aplcation",
}

def add_typos(text):
    for correct, wrong in TYPOS.items():
        if correct in text.lower():
            return text.lower().replace(correct, wrong, 1)
    # Random char swap
    words = text.split()
    if len(words) > 2:
        idx = random.randint(0, len(words)-1)
        w = list(words[idx])
        if len(w) > 3:
            i = random.randint(1, len(w)-2)
            w[i], w[i+1] = w[i+1], w[i]
            words[idx] = ''.join(w)
    return ' '.join(words)

# ── TRUNCATION ENGINE ──────────────────────────────
def truncate(text):
    words = text.split()
    if len(words) <= 2: return text
    # Keep key noun phrase
    for keyword in ["foreclose","foreclose","statement","payment","emi","interest",
                    "download","activate","block","close","part payment","drawdown",
                    "charges","noc","certificate","balance"]:
        if keyword in text.lower():
            return keyword
    return ' '.join(words[:min(3, len(words))])

# ── HINGLISH ENGINE ────────────────────────────────
HINGLISH_TEMPLATES = [
    "{action} karna hai",
    "mujhe {action} karna hai",
    "{action} kaise kare",
    "bhai {action} batao",
    "please {action} help karo",
    "urgent hai {action}",
    "{action} nahi ho raha",
    "abhi {action} chahiye",
    "mera {action} kab hoga",
]
ACTION_MAP = {
    "foreclose":"loan close","interest":"interest rate","statement":"statement",
    "payment":"payment","emi":"emi","download":"download","activate":"activate",
    "block":"block","part payment":"part payment","drawdown":"paise nikalna",
    "charges":"charges","noc":"noc","balance":"balance","certificate":"certificate",
}
def to_hinglish(text):
    tl = text.lower()
    for kw, action in ACTION_MAP.items():
        if kw in tl:
            tmpl = random.choice(HINGLISH_TEMPLATES)
            return tmpl.format(action=action)
    return text + " kaise kare"

# ── EMOTIONAL ENGINE ───────────────────────────────
EMOTIONAL = [
    "why is my {topic} so high??",
    "this is fraud! {topic}",
    "nobody is helping me with {topic}",
    "{topic} still not resolved!!",
    "i am very frustrated with {topic}",
    "pathetic service {topic}",
    "urgent {topic} please help!!",
    "ASAP {topic}",
]
TOPIC_MAP = {
    "emi":"emi","interest":"interest rate","charges":"charges",
    "payment":"payment","statement":"statement","loan":"loan","card":"card",
    "deposit":"deposit","foreclose":"foreclosure","balance":"outstanding",
}
def to_emotional(text):
    tl = text.lower()
    for kw, topic in TOPIC_MAP.items():
        if kw in tl:
            tmpl = random.choice(EMOTIONAL)
            return tmpl.format(topic=topic)
    return "this is ridiculous! " + text.lower()

# ── MIXED SCRIPT (Hinglish with English keywords) ──
MIXED = [
    "mera {kw} kab milega",
    "{kw} update nahi ho raha",
    "mere {kw} mein problem hai",
    "{kw} galat show ho raha hai",
    "{kw} band karna hai urgently",
    "aaj {kw} karna hai",
]
def to_mixed(text):
    words = text.split()
    # Find key noun
    key_nouns = ["emi","loan","card","statement","payment","balance","interest",
                 "charges","noc","certificate","account","deposit","mandate"]
    for kw in key_nouns:
        if kw in text.lower():
            tmpl = random.choice(MIXED)
            return tmpl.format(kw=kw)
    return "mere " + ' '.join(words[-2:]) + " mein issue hai"

# ── GENERATE ───────────────────────────────────────
random.seed(42)
# Sample max 500 per module for edge cases
from collections import defaultdict
by_module = defaultdict(list)
for r in source:
    by_module[r["Module"]].append(r)

edge_cases = []
seen = set(r["Test Question"].lower() for r in source)

for mod, rows in by_module.items():
    sample = random.sample(rows, min(100, len(rows)))
    for row in sample:
        q = row["Test Question"]
        variants = [
            (add_typos(q),      "Edge_Typo"),
            (truncate(q),       "Edge_Truncated"),
            (to_hinglish(q),    "Edge_Hinglish"),
            (to_emotional(q),   "Edge_Emotional"),
            (to_mixed(q),       "Edge_MixedScript"),
        ]
        for v, vtype in variants:
            if not v or v.lower() in seen or len(v) < 3: continue
            seen.add(v.lower())
            edge_cases.append({
                "Type":             row.get("Type","Service"),
                "Module":           mod,
                "L2":               row.get("L2",""),
                "L3":               row.get("L3",""),
                "Test Question":    v,
                "Expected Behaviour": f"Bot should handle {vtype} input and respond correctly",
                "Chatbot Flag":     "yes",
                "In-KB or Gap":     f"{vtype} (from: {q[:40]})",
                "Pass / Fail":      "",
                "Bot Response":     "",
                "Source File":      "edge_case_generator",
            })

# ── WRITE separate edge case CSV ───────────────────
edge_path = OUT_DIR / "blu_edge_cases.csv"
fields = ["Type","Module","L2","L3","Test Question","Expected Behaviour",
          "Chatbot Flag","In-KB or Gap","Pass / Fail","Bot Response","Source File"]
with open(edge_path, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    w.writerows(edge_cases)

counts = Counter(r["In-KB or Gap"].split(" (")[0] for r in edge_cases)
print(f"\n{'='*50}")
print(f"  EDGE CASE GENERATOR — SUMMARY")
print(f"{'='*50}")
print(f"  Total edge cases: {len(edge_cases):,}")
print(f"\n  By type:")
for t,c in sorted(counts.items()):
    print(f"    {t:<25} {c:>5}")
print(f"\n✅ Written → {edge_path}")
PYEOF
