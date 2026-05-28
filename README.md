# BLU Bot — Test Automation

Automated + manual testing framework for **BLU Bot** (Bajaj Finance AI assistant) across N2P and UAT environments.

---

## Repository Structure

```
BLU-Automation/
│
├── dashboard/                          ← Runtime files (server + UI)
│   ├── blu_test_dashboard_v4.html      ← Main test UI (open in browser)
│   ├── playwright_server.js            ← WebSocket bridge (Node.js)
│   ├── verdict_engine.js               ← 8-rule structural verdict engine
│   ├── llm_verdict.js                  ← LLM verdict via Ollama Llama 3.1 8B
│   ├── semantic_scorer.js              ← TF-IDF cosine similarity scoring
│   └── package.json                    ← Node dependencies
│
├── test-cases/                         ← Gitignored — generate locally (see Quick Start)
│   ├── v7/
│   │   ├── blu_test_cases_v7.csv           ← Primary (2,321 KB cases + 30 negative = 2,351)
│   │   └── blu_test_cases_v7_realistic.csv ← Realistic phrasing variants (generate separately)
│   ├── supplementary/
│   │   └── blu_negative_test_cases.csv     ← 30 negative cases (cross-product, PII, sourcing)
│   └── gaps/                               ← KB diff CSVs (generate via compare_kb.js)
│
├── scripts/
│   ├── generate/
│   │   ├── generate_test_cases_v7.js       ← Regenerate V7 from KB JSONs
│   │   ├── generate_realistic_variants.js  ← Rewrite V7 questions in real-user phrasing
│   │   └── generate_negative_cases.js      ← Generate cross-product/PII/sourcing test cases
│   ├── analysis/
│   │   ├── benchmark_realistic.js          ← Compare pass rates: V7 vs realistic
│   │   ├── compare_kb.js                   ← Diff two KB versions, output gap CSVs
│   │   └── aggregate_results.py            ← Post-run HTML + CSV report
│   └── kb/
│       └── kb_update_trigger.py            ← Auto-pipeline on KB update
│
├── knowledge_base/
│   ├── JSONs/
│   │   ├── May 07 - Latest Content/        ← Previous KB (reference)
│   │   └── May 22 - Latest Content/        ← Active KB (84 JSON files)
│   └── Excels/
│
├── logs/                               ← Gitignored — auto-created on first server run
│   ├── session_log_<date>.json         ← Per-session logs (keep last 5)
│   ├── .run_state.json                 ← Bulk run resume state
│   └── screenshots/                    ← Test screenshots
│
├── data/                               ← Gitignored — obtain from Ishaan
├── run_config.json.example
├── .gitignore
└── README.md
```

---

## Prerequisites

- **Node.js** v18+
- **Python 3.10+**
- **Ollama** — `brew install ollama` (optional but recommended for LLM scoring)
- **Llama 3.1 8B model** — see LLM Setup below
- Access to N2P/UAT test mobile + OTP

---

## Quick Start

### 1. Clone
```bash
git clone https://github.com/ishaan-bhatnagar-bfl/Blu-Bot-Testing.git
cd Blu-Bot-Testing
```

### 2. Install Node dependencies
```bash
cd dashboard && npm install && cd ..
```

### 3. LLM Setup (one-time, optional)
```bash
# Download Llama 3.1 8B (~4.6GB)
curl -L --retry 10 --retry-delay 15 -C - \
  "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf" \
  -o ~/Desktop/llama3.1-8b-q4.gguf

# Register with Ollama
echo 'FROM /Users/<your-username>/Desktop/llama3.1-8b-q4.gguf' > ~/Desktop/Modelfile
ollama create llama3.1-local -f ~/Desktop/Modelfile
```

### 4. Generate test cases (first-time setup)
```bash
node scripts/generate/generate_test_cases_v7.js    # 2,321 cases from KB JSONs
node scripts/generate/generate_negative_cases.js   # appends 30 negative cases → 2,351 total
```

### 5. Start services (3 terminals)

**Terminal 1 — Ollama (optional, for LLM scoring):**
```bash
ollama serve
```

**Terminal 2 — Bridge:**
```bash
cd dashboard && node playwright_server.js
```
Expected output:
```
✅ Browser launched
🧠 Ollama available — LLM verdict enabled (llama3.1-local)
🚀 Bridge running on ws://localhost:3001
```

**Terminal 3 — Dashboard:**
```bash
open dashboard/blu_test_dashboard_v4.html
```

### 6. Connect and test
1. Select env: **N2P** or **UAT**
2. Click **Connect to Bot** → enter mobile → OTP
3. Load `test-cases/v7/blu_test_cases_v7.csv` → filter by module → **⚡ Bulk Run**

---

## Environments

| Env | URL | OTP | Mobile |
|-----|-----|-----|--------|
| N2P | `https://bflaiassist-n2p.bajajfinserv.in/blu/?jid=blu` | Real OTP | `9953333141` |
| UAT | `https://bflaiassist-uat.bajajfinserv.in/blu/?jid=blu` | `123465` | PROD-mapped numbers only |

---

## Test Files

| File | Cases | Use for |
|------|-------|---------|
| `test-cases/v7/blu_test_cases_v7.csv` | 2,351 | Primary — daily runs, all modules |
| `test-cases/supplementary/blu_negative_test_cases.csv` | 30 | Cross-product, PII, sourcing guard validation |
| `test-cases/v7/blu_test_cases_v7_realistic.csv` | 2,321 | Realistic phrasing benchmark (generate separately) |

> All CSVs are gitignored. Generate them locally using the scripts in `scripts/generate/`.

---

## Dashboard Features

### Filter Pills
- **In-KB** — KB-verbatim cases only
- **Gap** — cases with no KB entry (auto-REVIEW)
- **⚠ Negative** — cross-product, PII, sourcing guard cases
- **Untested** — cases not yet run
- **Failed** — cases with FAIL verdict
- **⏭ First** — sorts untested cases to top

### Bulk Run
- **⚡ Bulk Run** → prompts for number of cases → runs in order
- **■ Stop** button → cancels run immediately
- Progress bar shows live: cases done / total, PASS ✓ / FAIL ✗ / REVIEW ~ counts

### Bulk Run Resume
If a bulk run is interrupted, `.run_state.json` is written after every case.
On next login, a banner shows the last tested module + topic with a Resume option.

### UAT Parity Check
After running any case, **⚖ Check on UAT** compares N2P vs UAT verdict.

### KB Diff
Click **KB Diff** in topbar → load both gap CSVs → see what changed between KB versions.
Modules with changes show a **Δn** amber badge in the sidebar.

### Coverage Rings
| Colour | Meaning |
|--------|---------|
| ⬜ Grey | Not tested yet |
| 🔴 Red | <50% PASS rate |
| 🟡 Amber | 50–74% PASS rate |
| 🔵 Blue | 75–89% PASS rate |
| 🟢 Green | ≥90% PASS rate |
| ⛔ | Blocked — `chatbot-flag=yes` missing in KB |

---

## Verdict Engine

Every bot response is scored by three layers:

### Layer 1 — Structural Rules (`verdict_engine.js`, ~0ms)

| Rule | What it checks |
|------|---------------|
| `SOURCING_GUARD` | Query is not a Sourcing/apply intent |
| `NO_FALLBACK` | Response is not a fallback/retry/error card |
| `LANGUAGE` | Response language matches query language |
| `MIN_LENGTH` | Response meets minimum length for module |
| `CTA_PRESENT` | CTA detected when KB expects one |
| `NO_CROSS_PRODUCT` | No unrelated product mentions |
| `ESCALATION_CHECK` | Escalation behaviour matches KB |
| `KEYWORD_MATCH` | Semantic similarity via TF-IDF (Layer 2) |

### Layer 2 — Semantic Scoring (`semantic_scorer.js`, ~1ms)
TF-IDF cosine similarity with financial domain stopwords and synonym expansion.
Thresholds: >25% = PASS, 10–25% = REVIEW, <10% = FAIL.

### Layer 3 — LLM Verdict (`llm_verdict.js`, ~3s)
Ollama Llama 3.1 8B Q4_K_M. Silent fallback to structural-only if Ollama not running.

---

## Session Behaviour

- **Auto-reset after 30 messages** — bot navigates back to login
- **Re-auth detection** — UAT auto-fills `123465`, N2P shows inline OTP banner
- **Message queue** — messages during retry countdown are queued, not dropped
- **Ollama off** = keyword + semantic scoring only

---

## Export CSV

Column order:
`Module → L3 → Test Question → In-KB or Gap → Bot Response → Manual Result → Expected Behaviour → Verdict → Verdict_Detail → CTA_Labels → CTA_Links → Chat ID → Tested_At`

After export, generate HTML report:
```bash
python3 scripts/analysis/aggregate_results.py <exported_results.csv>
```

---

## Realistic Variant Benchmark

```bash
# Step 1 — generate realistic variants (~45 min, Ollama required)
ollama serve
node scripts/generate/generate_realistic_variants.js

# Step 2 — run V7 baseline in dashboard, export
# Step 3 — run realistic CSV in dashboard, export

# Step 4 — compare
node scripts/analysis/benchmark_realistic.js \
  <path/to/v7_baseline_export.csv> \
  <path/to/v7_realistic_export.csv>
```

---

## When KB Updates

```bash
python3 scripts/kb/kb_update_trigger.py --new-folder "June 01 - Latest Content"
node scripts/generate/generate_test_cases_v7.js
node scripts/generate/generate_negative_cases.js
node scripts/analysis/compare_kb.js  # regenerate gap CSVs
```

---

## Reporting Bugs (ADO)

1. Failed case → 🐛 Bug button → auto-fills failed rules + LLM reason
2. Format: `CAI Team || WEB || [ENV] || [description]`
3. Click **Export + Copy** → paste into ADO work item

---

## Module Ownership

| Module | CAI PO |
|--------|--------|
| Flexi Loans PL / SME | Ishaan Bhatnagar |
| Flexi Wheels (NCF / UCF / TWF / NTR / UTR) | Ishaan Bhatnagar |
| LAFD | Ishaan Bhatnagar |
| EMI Card / Health EMI Card | Ishaan Bhatnagar |
| FD / SDP | Ishaan Bhatnagar |
| Help & Support (RAR & FAQ) | Ishaan Bhatnagar |
| Term Loan (PL & SME) | Ayushi Sharma |
| Term Wheels / LAS / ESOP / Insurance | Ayushi Sharma |
| Document Centre | Ayushi Sharma |
| Home Loan / LAP / BHFL | Irfan Shaikh |
| Upcoming EMI / Part-payment / Foreclosure | Irfan Shaikh |
| Gold Loan / Microfinance / B2B | Mekhala Dighe |
| Profile / DNC / Consent | Mekhala Dighe |
| Payments (UPI / BBPS / Wallets / FASTag) | Punit Bharmecha |
| DMS / EW | Punit Bharmecha |

**Zero-coverage modules** (content team action needed):
SME Flexi Loan, Home Loan, Loan Payments, Rewards, Help & Support — `chatbot-flag=yes` missing in May 22 JSONs.

---

## Scope

- ✅ **In scope:** All Service modules
- ❌ **Out of scope:** Sourcing flows (apply/application journeys)

---

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | ✅ Done | Retry lock, re-auth, virtual scroll |
| Phase 2 | ✅ Done | LLM verdict, disambiguation fix |
| Phase 3 | ✅ Done | Progress bar, active row, CTA chips, export |
| Phase 4 | ✅ Done | Bulk resume, UAT parity, semantic scoring |
| P4.1 | ✅ Done | Multi-turn automated runner |
| Realistic variants | 🔜 Pending | Run benchmark after Ollama generation |
| UAT parity bulk run | 🔜 Pending | Module-level N2P vs UAT sweep |
| Content gaps | ⛔ Blocked | chatbot-flag=yes for 5 modules |

---

## Maintainer

Ishaan Bhatnagar — CAI Team, Bajaj Finance
