# BLU Chatbot UAT Automation

Automated testing framework for Bajaj Finserv's BLU conversational AI (UAT).

Tests real customer utterances against the live bot, scores responses against the JSON knowledge base, and produces a CSV + JSON report per run.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [First-Time Setup](#first-time-setup)
3. [Data Setup](#data-setup)
4. [Generating Test Cases](#generating-test-cases)
5. [Running Tests](#running-tests)
6. [Module Filter Reference](#module-filter-reference)
7. [Understanding Results](#understanding-results)
8. [How Scoring Works](#how-scoring-works)
9. [Troubleshooting](#troubleshooting)
10. [For Contributors](#for-contributors)

---

## Prerequisites

- **Node.js** v18 or higher — [download here](https://nodejs.org/)
- **Git** — [download here](https://git-scm.com/)
- Access to the BLU UAT environment (mobile number + OTP bypass code — get from Ishaan Bhatnagar)
- Data files (see [Data Setup](#data-setup)) — obtain from Ishaan Bhatnagar

Check your Node version:
```bash
node --version
# Should print v18.x.x or higher
```

---

## First-Time Setup

### 1. Clone the repository

```bash
git clone https://github.com/ishaan-bhatnagar-bfl/CAI.git
cd CAI
```

### 2. Install dependencies

```bash
npm install
npx playwright install chromium
```

### 3. Create your config file

```bash
cp run_config.json.example run_config.json
```

Open `run_config.json` and fill in your credentials:

```json
{
  "BLU_URL": "https://bflaiassist-uat.bajajfinserv.in/blu/?jid=blu",
  "BLU_MOBILE": "xxxxxxxxxx",
  "BLU_OTP": "123465",
  "BATCH_SIZE": 20,
  "FILTER_MODULE": "",
  "DELAY_BETWEEN_MSGS_MS": 2000,
  "BOT_REPLY_TIMEOUT_MS": 45000
}
```

> `run_config.json` is gitignored — never committed. Never share your OTP bypass code over email or Slack.

---

## Data Setup

Place the following files in the `data/` folder. None are committed to the repo (gitignored).

| File | Required for | Source |
|---|---|---|
| `3IN1 CHAT DATA DUMP.csv` | v4/v5/v6 generator (old bot utterances) | Ishaan Bhatnagar |
| `Chat Dump_9_10_May.xlsx` | v5/v6 generator (new bot sessions) | Ishaan Bhatnagar |
| `Loan Knowledge Repository version-1.1.xlsx` | v5/v6 generator (KB merge) | Ishaan Bhatnagar |
| `Insurance Knowledge Repository version 1.1 1.xlsx` | v5 generator only | Ishaan Bhatnagar |

---

## Generating Test Cases

Run once before testing, or whenever JSONs or data files are updated.

### v6 (recommended — most accurate)

```bash
node scripts/generate_test_cases_v6.js
```

Uses utterance-to-KB-question matching (primary) + bot reply validation (secondary). Skips fallback-only sessions. Output: `data/blu_test_cases_v6.json`

### v5 (session-level mapping)

```bash
node scripts/generate_test_cases_v5.js
```

Uses bot reply → KB answer matching. Output: `data/blu_test_cases_v5.json`

### v4 (keyword mapping, old CSV only)

```bash
node scripts/generate_test_cases_v4.js
```

Output: `data/blu_test_cases_v4.json`

> Note: The test file `tests/blu_v4.test.js` reads from whichever JSON is specified. Update the `allCases` path in the test file to switch between v4/v5/v6.

---

## Running Tests

### Basic run (your module, batch of 20)

```bash
FILTER_MODULE="EMI_Card_Service" BATCH_SIZE=20 npx playwright test tests/blu_v4.test.js
```

### Run a specific L2

```bash
FILTER_MODULE="EMI_Card_Service" FILTER_L2="EMI Network Card" BATCH_SIZE=20 npx playwright test tests/blu_v4.test.js
```

### Run without module filter

```bash
BATCH_SIZE=20 npx playwright test tests/blu_v4.test.js
```

> Results are saved after every test case — partial results are preserved even if the run crashes.

---

## Module Filter Reference

Use these exact strings for `FILTER_MODULE`:

| Module | CAI PO | What it covers |
|---|---|---|
| `Flexi_Loan_PL_Service` | Ishaan Bhatnagar | Personal Flexi Loan, Professional & Business Flexi Loan |
| `Flexi_Loan_SME_Service` | Ishaan Bhatnagar | SME Flexi Loan |
| `Flexi_Loan_Wheels_Service` | Ishaan Bhatnagar | Two Wheeler, New/Used Car, New/Used Tractor |
| `Term_Loan_PL_Service` | Ayushi Sharma | Personal Term Loan, Consumer Loan |
| `Term_Loan_PB_Service` | Ayushi Sharma | Professional & Business Term Loan |
| `Home_Loan_Service` | Irfan Shaikh | Home Loan |
| `Gold_Loan_Service` | Mekhala Dighe | Gold Loan |
| `Microfinance_Service` | Mekhala Dighe | Microfinance Group Loan |
| `Business_Secured_Loan_Service` | Mekhala Dighe | Business Secured Loan |
| `LAS_Service` | Ayushi Sharma | Loan Against Securities |
| `LAFD_Service` | Ishaan Bhatnagar | Loan Against Fixed Deposit |
| `EMI_Card_Service` | Ishaan Bhatnagar | EMI Network Card, Health EMI Network Card |
| `Credit_Card_Service` | Ishaan Bhatnagar | Co-branded Credit Cards (discontinued) |
| `FD_SDP_Service` | Ishaan Bhatnagar | Fixed Deposit, SDP |
| `Insurance_Service` | Ayushi Sharma | Insurance Services |
| `Payments_UPI_Service` | Punit Bharmecha | UPI |
| `Payments_BBPS_Service` | Punit Bharmecha | BBPS |
| `Payments_Wallets_Service` | Punit Bharmecha | Wallets |
| `Fastag_Service` | Punit Bharmecha | Fastag |
| `Profile_Service` | Mekhala Dighe | Profile, DNC |
| `Rewards_Service` | Punit Bharmecha | Rewards |
| `Loan_Payments_Service` | Irfan Shaikh | Loan Payment Services |
| `Help_Support` | Ishaan Bhatnagar | Help on Raising a Request, Document Centre, KYC, CIBIL, KFS, Mandate |
| `Generic_Loan_Service` | Ishaan Bhatnagar | Generic Loan Queries |
| `Generic_Cards_Service` | Ishaan Bhatnagar | Generic Cards Queries |
| `Generic_Deposits_Service` | Ishaan Bhatnagar | Generic Deposit Queries |

---

## Understanding Results

After each run, two files are created in `results/`:

```
results/
  run_2026-05-12T10-30-00.json   ← full structured data
  run_2026-05-12T10-30-00.csv    ← open in Excel / Google Sheets
```

### CSV Columns

| Column | Description |
|---|---|
| TC ID | Unique test case ID |
| Module | Module tag |
| L1 / L2 / L3 | Category hierarchy |
| Utterance | Query sent to bot |
| Bot Reply | Full bot response (up to 1000 chars) |
| Expected Key Phrases | Phrases bot should mention |
| Matched Phrases | Phrases actually found |
| CTA Expected | Whether a CTA was expected |
| CTA Found | Whether a CTA was detected |
| Overall | Pass / Fail / Manual Review |
| Reason | Why it failed |
| Follow-up Rounds | Multi-turn follow-up count |
| Time (ms) | Response time |
| Mapping Type | `new_dump` / `old_csv` / `kb_verbatim` |
| Mapping Confidence | 0–100 match score |
| Scoring Type | `auto` or `manual` |

### Overall Values

- **Pass** — bot replied with expected content and CTA
- **Fail** — wrong answer, error, or missing CTA
- **Manual Review** — dynamic/relational answer; human must verify Bot Reply column

---

## How Scoring Works

### Auto scoring (static answers)
1. Extract key phrases from KB answer (CTA label, core instructions)
2. Check bot reply contains at least 1 key phrase
3. Check CTA present if expected
4. Both pass → **Pass**

### Manual Review (dynamic/relational answers)
KB answer references `customer_data` (EMI amounts, loan status, account details). Bot reply is logged; human reviews.

### Mapping types
- `new_dump` — from new bot sessions, confidence ≥ 30 — most reliable
- `new_dump_low_confidence` — from new bot sessions, confidence < 30 — treat with caution
- `old_csv` — from old bot CSV, confidence ≥ 30
- `old_csv_low_confidence` — old CSV, confidence < 30
- `kb_verbatim` — KB question used directly — highest reliability for scoring

---

## Troubleshooting

**"0 test cases matched filters"**

Check spelling of `FILTER_MODULE`:
```bash
node -e "const c=require('./data/blu_test_cases_v6.json'); console.log([...new Set(c.map(t=>t.module))].sort().join('\n'))"
```

**"data/blu_test_cases_v6.json not found"**

Run the generator first: `node scripts/generate_test_cases_v6.js`

**Consent screen not clearing**

Script handles consent automatically during login. If it loops, restart the run.

**Bot says "no active relation"**

UAT account relations may have been reset. Contact Ishaan Bhatnagar to restore UAT relations.

**OTP validation fails / Retry card appears during login**

Script retries up to 5 times. If it still fails, UAT server may be down — try again in a few minutes.

**Push to GitHub fails with 403**

Corporate and home networks block git push. Use mobile hotspot. If still failing:
```bash
git commit --allow-empty -m "unblock push"
git push
git reset HEAD~1
git push --force
```

---

## For Contributors

### Repository structure

```
CAI/
├── JSON(s)/
│   └── May 07 - Latest Content/   ← KB JSONs (do not edit)
├── scripts/
│   ├── generate_test_cases_v6.js  ← v6 generator (recommended)
│   ├── generate_test_cases_v5.js  ← v5 generator
│   ├── generate_test_cases_v4.js  ← v4 generator
│   ├── compare_kb.js              ← analysis: JSON vs repo overlap
│   ├── check_mapped.js            ← analysis: manual mapping coverage
│   ├── check_sr.js                ← analysis: SR dump structure
│   └── check_sr2.js               ← analysis: SR dump L1/L2 coverage
├── tests/
│   └── blu_v4.test.js             ← main test file (v4.7)
├── data/                          ← gitignored; place data files here
├── results/                       ← gitignored; run outputs here
├── playwright.config.js           ← 600s timeout
├── run_config.json.example        ← template; copy to run_config.json
├── package.json
└── README.md
```

### When JSONs are updated

```bash
node scripts/generate_test_cases_v6.js
FILTER_MODULE="YOUR_MODULE" BATCH_SIZE=5 npx playwright test tests/blu_v4.test.js
```

### Switching test case version

In `tests/blu_v4.test.js`, line ~19:
```javascript
const allCases = JSON.parse(fs.readFileSync(path.resolve('data/blu_test_cases_v6.json'), 'utf-8'));
```
Change `v6` to `v5` or `v4` as needed.

### Commit checklist

```bash
git add scripts/ tests/ playwright.config.js run_config.json.example README.md
git commit -m "your message"
# Use mobile hotspot for push if on corporate/home network
git push
```

---

## Quick Reference

```bash
# Setup (once)
npm install && npx playwright install chromium
cp run_config.json.example run_config.json

# Generate test cases
node scripts/generate_test_cases_v6.js

# Run your module
FILTER_MODULE="EMI_Card_Service" BATCH_SIZE=20 npx playwright test tests/blu_v4.test.js

# Results:
# results/run_<timestamp>.csv   ← open in Excel
# results/run_<timestamp>.json  ← structured data
```
