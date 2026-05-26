# BLU Bot — Test Automation

Automated + manual testing framework for **BLU Bot** (Bajaj Finance AI assistant) across N2P and UAT environments.

---

## Architecture

```
BLU-Automation/
├── dashboard/
│   ├── blu_test_dashboard_v4.html   ← Main test UI (open in browser)
│   ├── playwright_server.js         ← WebSocket bridge (Node.js)
│   └── verdict_engine.js            ← Formal Pass/Fail verdict rules
│
├── scripts/
│   ├── aggregate_results.py         ← Post-run HTML + CSV report generator
│   ├── kb_update_trigger.py         ← Auto-pipeline on KB update
│   ├── generate_test_cases_v6.js    ← Test case generator (utterance→KB matching)
│   ├── generate_test_cases_v7.js    ← Test case generator v7
│   ├── extract_questions.sh
│   ├── paraphrase_generator.sh
│   ├── edge_case_generator.sh
│   └── regression_suite.sh
│
├── knowledge_base/
│   ├── JSONs/
│   │   ├── May 07 - Latest Content/   ← Previous KB (reference)
│   │   └── May 22 - Latest Content/   ← Active KB (current)
│   └── Excels/
│       ├── Rahul More/
│       ├── Vaibhav Deshmukh/
│       └── Vikas Rathour/
│
├── automation/
│   ├── test-output/
│   │   ├── blu_test_cases_v7.csv          ← Primary test cases (1,552)
│   │   ├── blu_test_cases_v3_paraphrased.csv  ← Master (129K cases)
│   │   ├── blu_regression_suite.csv       ← 50 critical regression cases
│   │   ├── blu_edge_cases.csv             ← 4,479 stress/edge cases
│   │   ├── blu_multiturn_test_cases.csv   ← 66 multi-turn flows
│   │   └── reports/                       ← Aggregated run reports
│   ├── tests/
│   │   └── blu_v4.test.js                 ← Legacy Playwright CLI runner
│   └── playwright.config.js
│
└── data/                             ← Gitignored — obtain from Ishaan
    ├── 3IN1 CHAT DATA DUMP.csv
    ├── Chat Dump_9_10_May.xlsx
    └── Loan Knowledge Repository version-1.1.xlsx
```

---

## Quick Start

### Prerequisites
- **Node.js** v18+ — [nodejs.org](https://nodejs.org)
- **Python 3.10+** — for report generation and KB trigger scripts
- Access to N2P/UAT test mobile number + OTP — get from Ishaan Bhatnagar

### 1. Clone
```bash
git clone https://github.com/ishaan-bhatnagar-bfl/Blu-Bot---UAT-Testing.git
cd Blu-Bot---UAT-Testing
```

### 2. Install dependencies
```bash
cd dashboard
npm install playwright ws
```

### 3. Start the WebSocket bridge
```bash
cd dashboard
node playwright_server.js
```
Keep this terminal open. You should see:
```
✅ Browser launched
🚀 Bridge running on ws://localhost:3001
```

### 4. Open the dashboard
```bash
open dashboard/blu_test_dashboard_v4.html
```

### 5. Connect and test
1. Select environment: **N2P** or **UAT**
2. Click **Connect to Bot** → enter mobile → enter OTP
3. Load a test file: drag-drop a CSV or click **Load CSV**
4. Filter by module in the sidebar
5. Click **⚡ Bulk Run** or run cases individually

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
| `blu_test_cases_v7.csv` | 1,552 | Daily runs — scored, KB-mapped |
| `blu_test_cases_v3_paraphrased.csv` | 129K | Full coverage runs |
| `blu_regression_suite.csv` | 50 | Post-deploy sanity check |
| `blu_edge_cases.csv` | 4,479 | Stress: typos, Hinglish, truncated |
| `blu_multiturn_test_cases.csv` | 66 flows | Multi-turn manual testing |

All test files support both V3 (human-readable columns) and V7 (internal columns) formats — the dashboard normalises on load.

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
| Term Wheels (NCF / UCF / Tractor / CV / TWF) | Ayushi Sharma |
| LAS Service | Ayushi Sharma |
| ESOP Finance Service | Ayushi Sharma |
| Insurance (General / Health / Life / VAS / BALIC / Bajaj Prime) | Ayushi Sharma |
| Document Centre | Ayushi Sharma |
| Home Loan / LAP / BHFL / Affordable Housing | Irfan Shaikh |
| Upcoming EMI & Advance EMI | Irfan Shaikh |
| Part-payment & Foreclosure | Irfan Shaikh |
| Loan Cancellation Payment | Irfan Shaikh |
| Change / Swap Bank Account | Irfan Shaikh |
| Horizontals (Welcome screen, Navigation, Links) | Irfan Shaikh |
| Gold Loan Service | Mekhala Dighe |
| B2B Loan / Micro-Finance | Mekhala Dighe |
| Profile – ETB / PTB / NTB | Mekhala Dighe |
| Do Not Call (DNC) | Mekhala Dighe |
| Consent Management | Mekhala Dighe |
| Solar / Silver / Invoice Finance | Punit Bharmecha |
| Payments – UPI / BBPS / FT / Bills & Recharges | Punit Bharmecha |
| DMS – Collections CLP / Settlement / Overdue | Punit Bharmecha |
| EW – Extended Warranty | Punit Bharmecha |

---

## Scope

- **In scope:** All Service modules listed above
- **Out of scope:** Sourcing flows (any apply / application journey — e.g. EMI Card apply, Personal Loan apply). Note: CTAs pointing to sourcing are in scope; the apply journey itself is not.

---

## Verdict Engine

Every bot response is scored by `verdict_engine.js` against 8 structured rules:

| Rule | What it checks |
|------|---------------|
| `SOURCING_GUARD` | Query is not a Sourcing/apply intent |
| `NO_FALLBACK` | Response is not a fallback / retry card |
| `LANGUAGE` | Response language matches query language (Hinglish → Hinglish OK) |
| `MIN_LENGTH` | Response meets minimum length for this module |
| `CTA_PRESENT` | CTA detected when KB expects one |
| `NO_CROSS_PRODUCT` | Response doesn't mention unrelated products |
| `ESCALATION_CHECK` | Escalation behaviour matches KB expectation |
| `KEYWORD_MATCH` | Key phrases from KB answer present in response |

Verdict: **PASS** / **FAIL** / **REVIEW** / **SOURCING_SKIP**

Each rule shows individually in the response panel with ✓/✗/~/⊘ + reason.

---

## Reporting Bugs (ADO)

1. Any failed test case shows a 🐛 Bug button
2. Click it — the modal auto-fills ADO format:
   ```
   CAI Team || WEB || [ENV] || [description]
   ```
3. Click **Export + Copy** — copies to clipboard and downloads `.txt`
4. Paste into ADO work item

After a run, export the full results:
- Click **Export CSV** in the dashboard header
- Run the aggregator for an HTML report:
  ```bash
  python3 scripts/aggregate_results.py <exported_file.csv>
  ```
  Output → `automation/test-output/reports/report_YYYY-MM-DD.html`

---

## When KB Updates

Drop new JSONs into `knowledge_base/JSONs/[new folder]/` then:

```bash
python3 scripts/kb_update_trigger.py --new-folder "June 01 - Latest Content"
```

This runs: extract → generate v3 → paraphrase → generate v7 → diffs new vs previous test cases.

Diff output: `automation/test-output/kb_diff_YYYY-MM-DD.csv`
Columns: `Change_Type` (ADDED / REMOVED / CHANGED), `Question`, `Old_Answer`, `New_Answer`, `Notes`

---

## Multi-Turn Testing

`blu_multiturn_test_cases.csv` contains 66 flows (3–4 turns each) across all 7 primary modules. Run manually:

1. Send Turn 1 via the Direct input bar
2. Check bot response against `Expected_Bot_Action`
3. Send Turn 2, repeat
4. Flag deviations via 🐛 Bug modal

Flows cover: drawdown blocked, part payment, foreclosure, EMI card blocked/lost, FD maturity, LAFD, complaint escalation.

---

## Data Files (Gitignored)

The following files are not committed. Contact Ishaan Bhatnagar to obtain:

- `data/3IN1 CHAT DATA DUMP.csv` — 129K real user queries (Apr dump)
- `data/Chat Dump_9_10_May.xlsx` — May session chat dump
- `data/Loan Knowledge Repository version-1.1.xlsx` — Loan KB Excel

---

## Maintainer

Ishaan Bhatnagar — CAI Team, Bajaj Finance  
`ishaan.bhatnagar@bajajfinserv.in`
