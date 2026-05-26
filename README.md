# BLU Bot Test Automation

Automated + manual testing framework for **BLU Bot** (Bajaj Finance AI assistant) across UAT, N2P, and PROD environments.

---

## Folder Structure

```
BLU-Automation/
├── automation/              # Core test automation (Git repo)
│   ├── scripts/             # JS scripts (test case generation, KB analysis)
│   ├── tests/               # Playwright test runners
│   │   └── blu_v4.test.js   # Active UAT test runner
│   ├── test-output/         # Generated CSVs, screenshots
│   │   ├── blu_test_cases_v3_paraphrased.csv   # Master test cases (129K+)
│   │   ├── blu_regression_suite.csv            # 50 critical regression cases
│   │   ├── blu_edge_cases.csv                  # Stress test cases
│   │   └── screenshots/                        # Auto-captured failure screenshots
│   ├── playwright.config.js
│   └── run_config.json      # Environment + path configuration
│
├── dashboard/               # Interactive test dashboard
│   ├── blu_test_dashboard_v4.html   # Main dashboard UI
│   └── playwright_server.js         # WebSocket bridge (Node.js)
│
├── scripts/                 # Python/bash utility scripts
│   ├── extract_questions.sh         # Extract KB questions from JSONs
│   ├── analyze_diff.sh              # Diff Excel KB vs JSON KB
│   ├── generate_test_cases_v3.sh    # Generate test cases from JSONs
│   ├── paraphrase_generator.sh      # Generate natural language variants
│   ├── add_real_user_tests.sh       # Add chat dump queries as test cases
│   ├── edge_case_generator.sh       # Generate stress test cases
│   └── regression_suite.sh         # Build regression suite
│
├── knowledge_base/          # KB source files
│   ├── JSONs/
│   │   ├── May 07 - Latest Content/
│   │   └── May 22 - Latest Content/   ← Active KB
│   └── Excels/
│       ├── Vaibhav Deshmukh/          # KR_Sheet_BLU.xlsx, RAR & FAQ
│       ├── Rahul More/                # Card, FD, Loan KBs
│       └── Vikas Rathour/             # Insurance, Loan KRs
│
├── data/                    # Raw user data
│   ├── chat_dump/           # Chat Dump_2_Apr.xlsx, Chat Dump_9_10_May.xlsx
│   ├── search_dump/         # Raw text, STT, suggestion clicked dumps
│   └── seo_dump/            # Keyword dumps
│
└── .gitignore
```

---

## Quick Start

### 1. Install dependencies

```bash
cd ~/Desktop/BLU-Automation/automation
npm install
npx playwright install chromium

cd ~/Desktop/BLU-Automation/dashboard
npm install playwright ws
```

### 2. Start the dashboard

```bash
# Terminal 1 — start Playwright bridge
node ~/Desktop/BLU-Automation/dashboard/playwright_server.js

# Terminal 2 — open dashboard
open ~/Desktop/BLU-Automation/dashboard/blu_test_dashboard_v4.html
```

### 3. Connect and test

1. Load CSV: `automation/test-output/blu_test_cases_v3_paraphrased.csv`
2. Select environment: UAT / N2P / PROD
3. Click **Connect to Bot** → enter mobile number → enter OTP
4. Filter by module, run test cases, mark Pass/Fail
5. Export results CSV when done

---

## Test Case Files

| File | Cases | Description |
|------|-------|-------------|
| `blu_test_cases_v3_paraphrased.csv` | 129K+ | Master: In-KB + paraphrases + real user queries |
| `blu_regression_suite.csv` | 50 | Critical cases — run on every KB update |
| `blu_edge_cases.csv` | ~5K | Stress tests: typos, Hinglish, emotional, truncated |

---

## Regenerating Test Cases

When new JSONs are received:

```bash
# 1. Drop new JSONs into:
#    knowledge_base/JSONs/[Date] - Latest Content/

# 2. Update path in extract_questions.sh + generate_test_cases_v3.sh

# 3. Regenerate
bash ~/Desktop/BLU-Automation/scripts/extract_questions.sh
bash ~/Desktop/BLU-Automation/scripts/generate_test_cases_v3.sh
bash ~/Desktop/BLU-Automation/scripts/paraphrase_generator.sh
bash ~/Desktop/BLU-Automation/scripts/edge_case_generator.sh
bash ~/Desktop/BLU-Automation/scripts/regression_suite.sh

# 4. Diff new KB vs Excel KB
bash ~/Desktop/BLU-Automation/scripts/analyze_diff.sh
```

---

## KB Diff (Excel vs JSON)

```bash
bash ~/Desktop/BLU-Automation/scripts/analyze_diff.sh
# Output:
#   automation/test-output/gaps_excel_not_in_json.csv  ← raise with content team
#   automation/test-output/gaps_json_not_in_excel.csv  ← newer JSON content
```

---

## Running UAT Automated Tests (Playwright)

```bash
cd ~/Desktop/BLU-Automation/automation
npx playwright test tests/blu_v4.test.js
```

Results saved to `automation/test-output/`.

---

## Environments

| Env | URL | Notes |
|-----|-----|-------|
| N2P | `https://bflaiassist-n2p.bajajfinserv.in/blu/?jid=blu` | Non-prod, OTP required |
| UAT | TBD | No OTP |
| PROD | TBD | Live — use carefully |

---

## Scope

Testing covers **Service** modules only (not Sourcing):

- Flexi Loans (PL + SME)
- Flexi Wheels (NCF / UCF / TWF / NTR / UTR)
- LAFD
- EMI Card + Health EMI Card
- FD / SDP
- Help & Support (RAR + FAQs)

---

## Bug Reporting

Use the 🐛 button in the dashboard on any failed test case.

Format: `CAI Team || WEB || [ENV] || [Short description]`

Export copies to clipboard (paste into ADO) + downloads as `.txt`.

---

## Maintainer

Ishaan Bhatnagar — CAI Team, Bajaj Finance
