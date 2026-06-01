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
│   ├── semantic_scorer.js              ← TF-IDF cosine similarity + KB text cleaning
│   └── package.json                    ← Node dependencies
│
├── agent/                              ← Fully autonomous testing (zero human input after OTP)
│   ├── agent_runner.html               ← Agent launcher UI (open via localhost:3002)
│   ├── agent_server.js                 ← Express server on :3002, shares verdict pipeline
│   └── export_bugs.js                  ← Excel bug report (3 sheets: Bug Report, All Results, Summary)
│
├── test-cases/                         ← Gitignored — generate locally (see Quick Start)
│   ├── v7/
│   │   ├── blu_test_cases_v7.csv           ← Primary (2,321 KB cases + 30 negative = 2,351)
│   │   └── blu_test_cases_v7_realistic.csv ← Realistic phrasing variants (~2,321 cases)
│   ├── supplementary/
│   │   ├── blu_negative_test_cases.csv     ← 30 negative cases (cross-product, PII, sourcing)
│   │   └── blu_stress_test_cases.csv       ← 4,045 stress cases (typo, abbrev, compound, past tense, terse)
│   └── gaps/                               ← KB diff CSVs (generate via compare_kb.js)
│
├── scripts/
│   ├── generate/
│   │   ├── generate_test_cases_v7.js       ← Regenerate V7 from KB JSONs
│   │   ├── generate_realistic_variants.js  ← Rewrite V7 in real-user phrasing (~45 min, Ollama)
│   │   ├── generate_negative_cases.js      ← Cross-product/PII/sourcing test cases
│   │   └── generate_stress_variants.js     ← Stress variants: typos, abbreviations, compound, past tense, terse
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
│   ├── .run_state.json                 ← Dashboard bulk run resume state
│   ├── .module_run_state.json          ← Agent per-module run state (resume support)
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
| **Disambiguation** | User selects chip in floating modal | Auto-selects best chip |
| **Session cap** | Manual awareness | Configurable (default 18), auto re-auth |
| **Resume** | Per-bulk-run banner | Per-module progress bar + Resume/Restart toggle |
| **Verdicts** | Live in dashboard | In agent log + Excel export |
| **Bug output** | Export CSV | Excel (3 sheets) with ADO-ready titles |
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
cd dashboard && npm install && cd ..
npm install
```

### 3. LLM Setup (one-time, optional but recommended)
```bash
curl -L --retry 10 --retry-delay 15 -C - \
  "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf" \
  -o ~/Desktop/llama3.1-8b-q4.gguf

echo 'FROM /Users/<your-username>/Desktop/llama3.1-8b-q4.gguf' > ~/Desktop/Modelfile
ollama create llama3.1-local -f ~/Desktop/Modelfile
```

### 4. Generate test cases (first-time)
```bash
node scripts/generate/generate_test_cases_v7.js    # 2,321 cases from KB JSONs
node scripts/generate/generate_negative_cases.js   # appends 30 negative → 2,351 total
```

---

## Method A — Dashboard (Semi-autonomous)

Best for: reviewing verdicts live, investigating failures, manual override of REVIEW cases.

```bash
ollama serve                                      # Terminal 1 (optional)
cd dashboard && node playwright_server.js         # Terminal 2
open dashboard/blu_test_dashboard_v4.html         # Terminal 3
```

1. Select **N2P** or **UAT** → **Connect to Bot** → mobile → OTP
2. **Load CSV** → `test-cases/v7/blu_test_cases_v7.csv`
3. Filter to your module in sidebar
4. **⚡ Bulk Run** → enter number of cases → confirm
5. On disambiguation → select product in the floating chip panel
6. Review FAIL/REVIEW cases → mark manually
7. Results auto-exported on bulk run completion (also available via **Export CSV**)

**First time?** An onboarding overlay walks you through the 5 steps above. Dismisses permanently after "Got it".

---

## Method B — Agent (Fully autonomous)

Best for: large batches unattended, overnight runs, team-wide coverage.

```bash
ollama serve                    # Terminal 1 (optional)
node agent/agent_server.js      # Terminal 2
open http://localhost:3002/agent_runner.html
```

1. Select environment, mobile, test suite, cases per module
2. Set **Session Limit** (default 18 — bot resets after ~18-20 turns, agent re-auths automatically)
3. Select modules (owner shortcuts: Ishaan / Ayushi / Irfan / Mekhala / Punit)
4. **Modules with prior runs show a progress bar** — choose Resume or Restart per module
5. Start button adapts: **▶ Start** / **▶ Resume + Start** / **⏭ Resume Run**
6. **N2P:** enter OTP in the banner when prompted (UAT is fully automatic)
7. On completion → **📁 Open Bug Report** → `logs/agent_runs/bugs_<ENV>_<timestamp>.xlsx`

**Agent behaviour:**
- Auto-selects most relevant chip on disambiguation
- Waits up to 60s for retry cards; marks SKIP if card doesn't clear
- Detects "Number of attempts exceeded" → stops, exports partial results
- Screenshots on FAIL and REVIEW
- Re-auth every N cases (session cap) — N2P prompts OTP, UAT auto-fills

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
| `test-cases/v7/blu_test_cases_v7_realistic.csv` | ~2,321 | Realistic phrasing benchmark |
| `test-cases/supplementary/blu_stress_test_cases.csv` | 4,045 | Stress testing — typos, abbreviations, compound queries |

> All CSVs are gitignored. Generate locally using scripts in `scripts/generate/`.

**Negative case categories:**
- **Cross-product** — asking module A about module B (e.g. home loan enquiry in EMI Card context)
- **PII Guard** — requesting CVV, PAN, account number, OTP
- **Sourcing Guard** — apply/new product intent inside a service conversation

**Stress case categories:**
- **Typo** — character swaps, missing letters (`"emi crd blck karo"`)
- **Abbreviation** — shorthand (`"txn failed"`, `"mandate chng"`)
- **Compound** — two questions in one (`"block card and how to unblock later"`)
- **Past tense** — describing past events (`"my transaction had failed yesterday on Amazon"`)
- **Terse** — extremely short queries (`"mandate change"`, `"card blocked"`)

---

## Verdict Engine

Every bot response passes through three layers — identical in dashboard and agent.

### Layer 1 — Structural Rules (`verdict_engine.js`, ~0ms)

| Rule | What it checks |
|------|---------------|
| `SOURCING_GUARD` | Query is not a new product/apply intent |
| `NO_FALLBACK` | Response is not a fallback/retry/error card |
| `LANGUAGE` | Response language matches query language |
| `MIN_LENGTH` | Response meets module minimum length |
| `CTA_PRESENT` | CTA present when KB expects one (REVIEW if missing, not FAIL) |
| `NO_CROSS_PRODUCT` | No unrelated product contamination |
| `ESCALATION_CHECK` | Escalation matches KB expectation |
| `KEYWORD_MATCH` | TF-IDF cosine similarity (Layer 2) |

**Special verdicts:**
- `GAP_CASE` — auto-REVIEW, no KB entry
- `RETRY_CARD` — bot showed error card, test marked REVIEW (not FAIL)
- `RATE_LIMITED` — bot rate-limited, run stopped and exported

### Layer 2 — Semantic Scoring (`semantic_scorer.js`, ~1ms)
TF-IDF cosine similarity. KB `Expected Behaviour` is cleaned before scoring — strips CTA blocks, deeplinks, JSON field references, KB-internal instructions. Leaves only human-readable answer text.

Thresholds: >25% = PASS · 10–25% = REVIEW · <10% = FAIL

Financial synonym expansion: `network↔emi↔insta`, `card↔cards`, `transaction↔purchase↔buy`, `block↔freeze`, `foreclose↔closure`, and more.

### Layer 3 — LLM Verdict (`llm_verdict.js`, ~3s)
Ollama Llama 3.1 8B Q4_K_M.

**Pre-LLM confidence gate:** if all structural rules pass and semantic confidence ≥60%, LLM is skipped — structural verdict is sufficient. Reduces LLM calls by ~40-50% on well-covered modules.

**Hybrid override:** LLM ≥70% confidence can promote REVIEW → PASS.

Silent fallback to structural-only if Ollama not running.

---

## Dashboard Features

### Filter Pills
- **In-KB** — KB-verbatim cases
- **Gap** — no KB entry (auto-REVIEW)
- **⚠ Negative** — cross-product, PII, sourcing guard
- **Untested** — not yet run
- **Failed** — FAIL verdict
- **⏭ First** — sorts untested to top

### Bulk Run
- Progress bar with live PASS ✓ / FAIL ✗ / REVIEW ~ counts
- Results **auto-exported on completion** — no manual export needed
- `.run_state.json` written after every case for resume support

### Disambiguation Chip Panel
Floating modal with product chip buttons, 60s countdown ring, Skip option. Appears automatically when bot asks to select a product/relation.

### KB Diff
**KB Diff** → load both gap CSVs → tabbed diff view. Modules with changes show **Δn** amber badge.

### Coverage Rings

| Colour | PASS rate |
|--------|-----------|
| ⬜ Grey | Not tested |
| 🔴 Red | < 50% |
| 🟡 Amber | 50–74% |
| 🔵 Blue | 75–89% |
| 🟢 Green | ≥ 90% |
| ⛔ | Blocked — `chatbot-flag=yes` missing in KB |

### UAT Parity Check
**⚖ Check on UAT** — compares N2P vs UAT verdict on the same case side by side.

---

## Agent — Per-Module Resume

The agent saves run state per module after every case to `logs/.module_run_state.json`.

On the next run:
- Modules with prior progress show a **progress bar** (done/total · pass/fail · time ago)
- A **Resume / Restart toggle** appears when the module is selected
- **Resume** — continues from the last completed case
- **Restart** — starts from the beginning, overwrites prior state

The **Start button** adapts:
- All fresh → `▶ Start Agent Run`
- Some resuming → `▶ Resume + Start Run`
- All resuming → `⏭ Resume Run`

---

## Agent Bug Report (Excel)

3 sheets, saved to `logs/agent_runs/bugs_<ENV>_<timestamp>.xlsx` after every run.

**Sheet 1 — Bug Report** (FAIL + REVIEW only, ADO-ready)

| Column | Content |
|--------|---------|
| ADO Title | `CAI Team \|\| WEB \|\| [ENV] \|\| [Module] — [Test Question]` |
| Verdict | FAIL / REVIEW |
| Module, L3, TC ID | Case identifiers |
| Test Question | Exact question sent |
| Bot Response | Full captured response |
| Expected Behaviour | KB expected behaviour |
| Failed Rules | Which rules failed |
| Chat ID | For ADO reproduction steps |
| Notes | Blank — fill manually before filing |

**Sheet 2 — All Results** (every tested case — full audit trail)

**Sheet 3 — Summary** (per-module pass/fail/review totals + pass rate %)

---

## Stress Variant Generation

```bash
# All modules — samples every 3rd V7 case (~45-60 min, Ollama required)
ollama serve
node scripts/generate/generate_stress_variants.js

# Single module
node scripts/generate/generate_stress_variants.js --module EMI_Card_Service

# Limited run
node scripts/generate/generate_stress_variants.js --limit 100

# Dry run (no LLM, test pipeline only)
node scripts/generate/generate_stress_variants.js --dry-run
```

Output: `test-cases/supplementary/blu_stress_test_cases.csv` (~4,045 cases across 5 categories)

---

## Realistic Variant Benchmark

```bash
# Step 1 — generate (~45 min, Ollama required)
ollama serve
node scripts/generate/generate_realistic_variants.js

# Step 2 — run V7 baseline in dashboard/agent, export
# Step 3 — run realistic CSV, export

# Step 4 — compare
node scripts/analysis/benchmark_realistic.js <v7_baseline.csv> <v7_realistic.csv>
```

The pass rate gap between V7 (KB-verbatim) and realistic (real-user phrasing) shows where the bot fails on natural language. A 20%+ gap on a module warrants KB or prompt improvements.

---

## Session Behaviour

- **Session cap** (agent) — re-auth every N cases (default 18). Configurable in launcher UI. Prevents hitting the bot's ~18-20 turn reset limit.
- **Auto-reset** (dashboard) — bot navigates to login after 30 messages, re-auth triggered automatically
- **Re-auth** — UAT: auto-fills `123465` · N2P: shows OTP input banner
- **Retry cards** — agent waits up to 60s for dismissal, marks REVIEW with `RETRY_CARD` rule if card persists
- **Ollama off** — falls back to structural + semantic scoring only (~40-50% faster per case)

---

## When KB Updates

```bash
python3 scripts/kb/kb_update_trigger.py --new-folder "June 01 - Latest Content"
node scripts/generate/generate_test_cases_v7.js
node scripts/generate/generate_negative_cases.js
node scripts/analysis/compare_kb.js
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
| Phase 1–4 (stability, LLM, dashboard, semantic) | ✅ Done |
| Agent runner (autonomous, OTP pause, Excel export) | ✅ Done |
| Per-module resume + session cap | ✅ Done |
| Pre-LLM confidence gate | ✅ Done |
| KB text cleaning before scoring | ✅ Done |
| Adaptive gap between cases | ✅ Done |
| Dashboard onboarding + auto-export | ✅ Done |
| Stress variant generator (4,045 cases, 5 categories) | ✅ Done |
| Realistic variants (2,321, 100% rewrite rate) | ✅ Done |
| Run module baselines before team share | 🔜 Next |
| Realistic variant benchmark | 🔜 Pending — after baselines |
| UAT parity bulk run | 🔜 Pending |
| Multi-agent (parallel per owner) | 🔜 Pending — needs multiple test mobiles |
| Content gaps (chatbot-flag=yes, 5 modules) | ⛔ Blocked — content team |

---

## Maintainer

Ishaan Bhatnagar — CAI Team, Bajaj Finance
