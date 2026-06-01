# BLU Bot — Test Automation

Automated testing framework for **BLU Bot** (Bajaj Finance AI assistant) across N2P and UAT environments. Supports both semi-autonomous (dashboard) and fully autonomous (agent) testing modes.

---

## Repository Structure

```
BLU-Automation/
│
├── dashboard/                          ← Semi-autonomous testing (human-in-the-loop)
│   ├── blu_test_dashboard_v4.html      ← Main test UI (open in browser)
│   ├── playwright_server.js            ← WebSocket bridge on ws://localhost:3001
│   ├── verdict_engine.js               ← 8-rule structural verdict engine
│   ├── llm_verdict.js                  ← LLM verdict via Ollama Llama 3.1 8B
│   ├── semantic_scorer.js              ← TF-IDF cosine similarity scoring
│   └── package.json                    ← Node dependencies
│
├── agent/                              ← Fully autonomous testing (zero human input after OTP)
│   ├── agent_runner.html               ← Agent launcher UI (open via localhost:3002)
│   ├── agent_server.js                 ← Express server on :3002, shares verdict pipeline
│   └── export_bugs.js                  ← Excel bug report generator (FAIL + REVIEW cases)
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
│   │   └── aggregate_results.py            ← Post-run report generator
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
│   ├── session_log_<date>.json         ← Dashboard session logs (keep last 5)
│   ├── .run_state.json                 ← Bulk run resume state
│   ├── screenshots/                    ← FAIL/REVIEW screenshots
│   └── agent_runs/                     ← Agent Excel bug reports
│
├── data/                               ← Gitignored — obtain from Ishaan
├── run_config.json.example
├── .gitignore
└── README.md
```

---

## Two Testing Modes

| | Dashboard (Semi-autonomous) | Agent (Fully autonomous) |
|---|---|---|
| **Human input** | OTP + chip selection on disambiguation | OTP only (N2P), none (UAT) |
| **Module selection** | Filter in sidebar | Checkbox UI with owner shortcuts |
| **Disambiguation** | User selects chip in dashboard panel | Auto-selects best chip |
| **Verdicts** | Live in dashboard | In agent log + Excel export |
| **Bug output** | Export CSV | Excel with ADO-ready titles |
| **Port** | ws://localhost:3001 | http://localhost:3002 |

---

## Prerequisites

- **Node.js** v18+
- **Python 3.10+**
- **Ollama** — `brew install ollama` (optional but recommended for LLM scoring)
- **Llama 3.1 8B model** — see LLM Setup below
- Access to N2P/UAT test mobile + OTP — get from Ishaan Bhatnagar

---

## Quick Start

### 1. Clone
```bash
git clone https://github.com/ishaan-bhatnagar-bfl/Blu-Bot-Testing.git
cd Blu-Bot-Testing
```

### 2. Install dependencies
```bash
# Dashboard
cd dashboard && npm install && cd ..

# Root (agent + scripts)
npm install
```

### 3. LLM Setup (one-time, optional but recommended)
```bash
# Download Llama 3.1 8B Q4_K_M (~4.6GB)
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

---

## Method A — Dashboard (Semi-autonomous)

Best for: reviewing verdicts live, investigating failures, manual override of REVIEW cases.

```bash
# Terminal 1 — LLM (optional)
ollama serve

# Terminal 2 — Bridge
cd dashboard && node playwright_server.js

# Terminal 3 — Open dashboard
open dashboard/blu_test_dashboard_v4.html
```

1. Select **N2P** or **UAT** in topbar
2. Click **Connect to Bot** → enter mobile → enter OTP
3. Click **Load CSV** → select `test-cases/v7/blu_test_cases_v7.csv`
4. Filter to your module in the sidebar
5. Click **⚡ Bulk Run** → enter number of cases → confirm
6. On disambiguation prompts → select product in the chip panel that appears
7. Review FAIL/REVIEW cases → mark Pass/Fail manually → **Export CSV**

---

## Method B — Agent (Fully autonomous)

Best for: running large batches unattended, overnight runs, team-wide module coverage.

```bash
# Terminal 1 — LLM (optional)
ollama serve

# Terminal 2 — Agent server
node agent/agent_server.js

# Browser
open http://localhost:3002/agent_runner.html
```

1. Select environment, mobile number, test suite, cases per module
2. Check modules to test (or use owner shortcuts: Ishaan / Ayushi / Irfan / Mekhala / Punit)
3. Click **▶ Start Agent Run**
4. **N2P only:** enter OTP when the banner appears (UAT is fully automatic)
5. Watch live progress — module rings, pass/fail/review counts, run log
6. On completion → **📁 Open Bug Report** → Excel file in `logs/agent_runs/`

**Agent behaviour:**
- Auto-selects the most relevant chip on disambiguation prompts
- Waits up to 60s for retry cards to clear before marking SKIP
- Detects "Number of attempts exceeded" → stops run, exports partial results
- Screenshots taken on FAIL and REVIEW cases
- Re-auth handled automatically (UAT: auto OTP; N2P: prompts via UI banner)

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
| `test-cases/supplementary/blu_negative_test_cases.csv` | 30 | Cross-product, PII, sourcing guard |
| `test-cases/v7/blu_test_cases_v7_realistic.csv` | 2,321 | Realistic phrasing benchmark |

> All CSVs are gitignored. Generate locally using scripts in `scripts/generate/`.

**Negative case categories:**
- **Cross-product** — asking module A about module B's product (e.g. home loan from EMI Card context)
- **PII Guard** — requesting sensitive data (CVV, PAN, account number, OTP)
- **Sourcing Guard** — apply/new product intent inside a service conversation

---

## Verdict Engine

Every bot response passes through three layers — identical in both dashboard and agent.

### Layer 1 — Structural Rules (`verdict_engine.js`, ~0ms)

| Rule | What it checks |
|------|---------------|
| `SOURCING_GUARD` | Query is not a new product/apply intent |
| `NO_FALLBACK` | Response is not a fallback/retry/error card |
| `LANGUAGE` | Response language matches query language |
| `MIN_LENGTH` | Response length meets module minimum |
| `CTA_PRESENT` | CTA present when KB expects one |
| `NO_CROSS_PRODUCT` | No unrelated product mentions |
| `ESCALATION_CHECK` | Escalation matches KB expectation |
| `KEYWORD_MATCH` | TF-IDF cosine similarity (Layer 2) |

**Special verdicts:**
- `GAP_CASE` — auto-REVIEW, no KB entry exists
- `RETRY_CARD` — bot showed error card, test skipped (not FAIL)
- `RATE_LIMITED` — bot rate-limited, run stopped

### Layer 2 — Semantic Scoring (`semantic_scorer.js`, ~1ms)
TF-IDF cosine similarity with financial domain stopwords and synonym expansion.
Thresholds: >25% = PASS, 10–25% = REVIEW, <10% = FAIL.

### Layer 3 — LLM Verdict (`llm_verdict.js`, ~3s)
Ollama Llama 3.1 8B Q4_K_M. Hybrid override: LLM ≥70% confidence can promote REVIEW → PASS.
Silent fallback to structural-only if Ollama not running.

---

## Dashboard Features

### Filter Pills
- **In-KB** — KB-verbatim cases only
- **Gap** — cases with no KB entry
- **⚠ Negative** — cross-product, PII, sourcing guard cases
- **Untested** — cases not yet run
- **Failed** — FAIL verdict cases
- **⏭ First** — sorts untested to top

### Bulk Run Resume
`.run_state.json` written after every case. On next login a banner shows last tested module + topic with a Resume option.

### Disambiguation Chip Panel
When bot asks to select a product, a floating modal appears with the available chips, a 60s countdown ring, and a Skip option.

### KB Diff
**KB Diff** button → load both gap CSVs → tabbed view of added/removed entries since last KB version. Modules with changes show **Δn** amber badge in sidebar.

### Coverage Rings (per module)

| Colour | PASS rate |
|--------|-----------|
| ⬜ Grey | Not tested |
| 🔴 Red | < 50% |
| 🟡 Amber | 50–74% |
| 🔵 Blue | 75–89% |
| 🟢 Green | ≥ 90% |
| ⛔ | Blocked — missing `chatbot-flag=yes` in KB |

### UAT Parity Check
**⚖ Check on UAT** on any case — compares N2P vs UAT verdict side by side.

### Export CSV
`Module → L3 → Test Question → In-KB or Gap → Bot Response → Manual Result → Expected Behaviour → Verdict → Verdict_Detail → CTA_Labels → CTA_Links → Chat ID → Tested_At`

---

## Agent Bug Report (Excel)

Saved to `logs/agent_runs/bugs_<ENV>_<timestamp>.xlsx` after every run (including stopped/rate-limited runs).

**Sheet 1 — Bug Report**

| Column | Content |
|--------|---------|
| ADO Title | `CAI Team \|\| WEB \|\| [ENV] \|\| [Module] — [Test Question]` |
| Verdict | FAIL / REVIEW |
| Module, L3, TC ID | Case identifiers |
| Test Question | Exact question sent |
| Bot Response | Full response captured |
| Expected Behaviour | KB expected behaviour |
| Failed Rules | Rules that failed |
| Chat ID | For reproduction |
| Notes | Empty — fill manually |

**Sheet 2 — Summary**: per-module pass/fail/review totals and pass rate.

---

## Session Behaviour

- **Auto-reset at 30 messages** — bot returns to login screen
- **Re-auth** — UAT auto-fills `123465`; N2P shows inline OTP banner in dashboard or agent UI
- **Retry cards** — agent waits up to 60s for dismissal; dashboard queues messages during countdown
- **Ollama off** — falls back to structural + semantic scoring only

---

## Realistic Variant Benchmark

```bash
# Step 1 — generate (~45 min, Ollama required)
ollama serve
node scripts/generate/generate_realistic_variants.js

# Step 2 — run V7 baseline in dashboard, export results
# Step 3 — run realistic CSV in dashboard, export results

# Step 4 — compare
node scripts/analysis/benchmark_realistic.js \
  <v7_baseline_export.csv> \
  <v7_realistic_export.csv>
```

The pass rate gap between V7 (KB-verbatim) and realistic (real-user phrasing) identifies where the bot fails on natural language.

---

## When KB Updates

```bash
python3 scripts/kb/kb_update_trigger.py --new-folder "June 01 - Latest Content"
node scripts/generate/generate_test_cases_v7.js
node scripts/generate/generate_negative_cases.js
node scripts/analysis/compare_kb.js  # regenerate gap CSVs
```

---

## Module Ownership

| Module | CAI PO |
|--------|--------|
| Flexi Loans PL / SME | Ishaan Bhatnagar |
| Flexi Wheels (NCF / UCF / TWF / NTR / UTR) | Ishaan Bhatnagar |
| LAFD | Ishaan Bhatnagar |
| EMI Card / Health EMI Card | Ishaan Bhatnagar |
| FD / SDP | Ishaan Bhatnagar |
| Help & Support | Ishaan Bhatnagar |
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

| Item | Status |
|------|--------|
| Phase 1 — Stability (retry lock, re-auth, virtual scroll) | ✅ Done |
| Phase 2 — LLM verdict, disambiguation | ✅ Done |
| Phase 3 — Dashboard (progress bar, CTA chips, export) | ✅ Done |
| Phase 4 — Bulk resume, UAT parity, semantic scoring | ✅ Done |
| Phase 4.1 — Multi-turn runner, chip panel | ✅ Done |
| Verdict engine fixes (fallback/escalation overlap, MIN_LENGTH) | ✅ Done |
| Negative test cases (cross-product, PII, sourcing) | ✅ Done |
| KB Diff dashboard (Δ badge, tabbed modal) | ✅ Done |
| Realistic variant generator (100% rewrite rate) | ✅ Done |
| Terminal log cleanup (clean output, elapsed timing) | ✅ Done |
| Agent runner (autonomous, Excel export, OTP pause) | ✅ Done |
| Realistic variant benchmark | 🔜 Pending — run after module baselines established |
| UAT parity bulk run | 🔜 Pending — module-level N2P vs UAT sweep |
| Multi-agent (parallel per owner, coordinator) | 🔜 Pending — needs multiple test mobiles |
| Content gaps (chatbot-flag=yes for 5 modules) | ⛔ Blocked — content team |

---

## Maintainer

Ishaan Bhatnagar — CAI Team, Bajaj Finance
