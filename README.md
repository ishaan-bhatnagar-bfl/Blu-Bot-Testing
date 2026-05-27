# BLU Bot — Test Automation

Automated + manual testing framework for **BLU Bot** (Bajaj Finance AI assistant) across N2P and UAT environments.

---

## Architecture

```
BLU-Automation/
├── dashboard/
│   ├── blu_test_dashboard_v4.html   ← Main test UI (open in browser)
│   ├── playwright_server.js         ← WebSocket bridge v3.0 (Node.js)
│   ├── verdict_engine.js            ← Structured keyword verdict rules
│   ├── llm_verdict.js               ← LLM verdict via Ollama Llama 3.1 8B
│   └── semantic_scorer.js           ← TF-IDF cosine similarity scoring
│
├── scripts/
│   ├── aggregate_results.py         ← Post-run HTML + CSV report
│   ├── kb_update_trigger.py         ← Auto-pipeline on KB update
│   ├── generate_test_cases_v7.js    ← Test case generator v7.1
│   ├── extract_questions.sh
│   ├── paraphrase_generator.sh
│   ├── edge_case_generator.sh
│   └── regression_suite.sh
│
├── knowledge_base/
│   ├── JSONs/
│   │   ├── May 07 - Latest Content/   ← Previous KB (reference)
│   │   └── May 22 - Latest Content/   ← Active KB (84 JSON files)
│   └── Excels/
│
├── automation/
│   ├── test-output/
│   │   ├── blu_test_cases_v7.csv          ← Primary (2,321 cases, all modules)
│   │   ├── blu_test_cases_v3_paraphrased.csv  ← Master (129K real user cases)
│   │   ├── blu_regression_suite.csv       ← 50 critical regression cases
│   │   ├── blu_edge_cases.csv             ← 4,479 stress/edge cases
│   │   ├── blu_multiturn_test_cases.csv   ← 66 multi-turn flows
│   │   ├── .run_state.json                ← Auto-created — bulk run resume state
│   │   └── reports/                       ← Aggregated run reports
│   └── playwright.config.js
│
└── data/                             ← Gitignored — obtain from Ishaan
```

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
git clone https://github.com/ishaan-bhatnagar-bfl/BLU-Bot-Testing.git
cd BLU-Bot-Testing
```

### 2. Install Node dependencies
```bash
cd dashboard && npm install playwright ws
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

### 4. Start services (3 terminals)

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

### 5. Connect and test
1. Select env: **N2P** or **UAT**
2. Click **Connect to Bot** → enter mobile → OTP
3. Load test CSV → filter by module → set cases → **⚡ Bulk Run**

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
| `blu_test_cases_v7.csv` | 2,321 | Daily runs — all modules, KB-verbatim |
| `blu_test_cases_v3_paraphrased.csv` | 129K | Full coverage — real user utterances |
| `blu_regression_suite.csv` | 50 | Post-deploy sanity check |
| `blu_edge_cases.csv` | 4,479 | Stress: typos, Hinglish, truncated |
| `blu_multiturn_test_cases.csv` | 66 flows | Multi-turn manual testing |

Both V3 and V7 column formats load correctly — dashboard normalises on load.

---

## Dashboard Features

### Bulk Run
- **⚡ Bulk Run** → prompts for number of cases → runs in order
- **⏭ Untested first** toggle → sorts untested cases to top (use for next-day resume)
- **■ Stop** button in progress bar → cancels run immediately
- Progress bar shows live: cases done / total, PASS ✓ / FAIL ✗ / REVIEW ~ counts

### Bulk Run Resume
If a bulk run is interrupted, `.run_state.json` is written after every case.
Next session, on login an accent banner appears:
```
⏮ Last run: 45/112 cases on 27 May 11:23 AM (last: TC_00045)  [Resume]  [Dismiss]
```
Click **Resume** → Untested First activates → list re-sorts → bulk run continues from TC_00046.

### UAT Parity Check
After running any test case, a **⚖ Check on UAT** button appears in the response panel.
Click it → server sends same question to UAT → compares verdict:
- 🟢 N2P = UAT — results match
- 🔴 N2P ≠ UAT — mismatch flagged, both responses shown

### Direct Input
- Auto-grow textarea — expands up to 4 lines as you type
- `Enter` to send, `Shift+Enter` for newline

### CTA Deep Links
CTA buttons in response panel show as green chips. Click to copy the `bajajsuperapp://` deep link to clipboard for manual verification.

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
| `KEYWORD_MATCH` | Semantic similarity via TF-IDF (see Layer 2) |

### Layer 2 — Semantic Scoring (`semantic_scorer.js`, ~1ms)
Replaces simple keyword overlap in `KEYWORD_MATCH`:
- TF-IDF cosine similarity between KB expected answer and bot response
- Financial domain stopwords excluded
- Synonym expansion: drawdown↔withdraw, block↔freeze, relations↔product, etc.
- Thresholds: >25% = PASS, 10–25% = REVIEW, <10% = FAIL
- Falls back to keyword overlap if `semantic_scorer.js` unavailable

### Layer 3 — LLM Verdict (`llm_verdict.js`, ~3s)
Semantic evaluation via Ollama Llama 3.1 8B:
- Disambiguation responses ("Please select the relation") → REVIEW, no LLM call
- Sourcing queries → SOURCING_SKIP
- Hybrid logic: LLM overrides structural verdict on disagreement
- Silent fallback to structural-only if Ollama not running

**Hybrid rules:**
- LLM FAIL + keyword PASS → FAIL
- LLM PASS + keyword FAIL → REVIEW
- Both agree → that verdict

**Terminal output per test:**
```
🤖 Response (1.2s): Your EMI card limit is ₹2.5L...
🧠 LLM: ✅ PASS (91%) — Response correctly states EMI card limit
```

---

## Session Behaviour

- **Auto-reset after 30 messages** — bot navigates back to login
- **Re-auth detection** — server detects login screen, re-authenticates:
  - UAT: uses `123465` automatically
  - N2P: shows inline OTP input in dashboard header banner
- **Message queue** — messages during retry countdown are queued, not dropped
- **Retry card handling** — server waits out countdown, clicks Retry when active
- **Ollama off** = keyword + semantic scoring only, no forced FAILs

---

## Export CSV

Column order:
`Module → L3 → Test Question → In-KB or Gap → Bot Response → Manual Result → Expected Behaviour → Verdict → Verdict_Detail → CTA_Labels → CTA_Links → Chat ID`

`Verdict_Detail` contains per-rule breakdown + LLM verdict reason.
Only tested cases are exported.

After export, generate HTML report:
```bash
python3 scripts/aggregate_results.py <exported_results.csv>
# Output → automation/test-output/reports/report_YYYY-MM-DD.html
```

---

## Reporting Bugs (ADO)

1. Failed case shows 🐛 Bug button — auto-fills failed rule names
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

## When KB Updates

```bash
python3 scripts/kb_update_trigger.py --new-folder "June 01 - Latest Content"
node scripts/generate_test_cases_v7.js
```

---

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | ✅ Done | Retry lock, re-auth, virtual scroll |
| Phase 2 | ✅ Done | LLM verdict, disambiguation fix |
| Phase 3 | ✅ Done | Progress bar, active row, CTA chips, export fix |
| Phase 4 | ✅ Done | Bulk resume, UAT parity, semantic scoring |
| P4.1 | 🔜 Next | Multi-turn automated runner |
| Content gaps | ⛔ Blocked | Sourcing JSONs + chatbot-flag=yes for 5 modules |

---

## Maintainer

Ishaan Bhatnagar — CAI Team, Bajaj Finance
