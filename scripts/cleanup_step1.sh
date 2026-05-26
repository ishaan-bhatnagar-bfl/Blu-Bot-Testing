#!/bin/bash
BASE=~/Desktop/BLU-Automation

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Step 1 — Cleanup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. automation/scripts — remove superseded JS scripts
echo "🗑️  Removing superseded scripts..."
rm -f "$BASE/automation/scripts/generate_test_cases.js"
rm -f "$BASE/automation/scripts/generate_test_cases_v3.0.js"
rm -f "$BASE/automation/scripts/check_ib_mapping.js"
rm -f "$BASE/automation/scripts/check_mapped.js"
rm -f "$BASE/automation/scripts/check_merge.js"
rm -f "$BASE/automation/scripts/check_sheets.js"
rm -f "$BASE/automation/scripts/check_sr.js"
rm -f "$BASE/automation/scripts/check_sr2.js"

# 2. automation/tests — remove superseded test files
echo "🗑️  Removing superseded tests..."
rm -f "$BASE/automation/tests/blu.test.js"
rm -f "$BASE/automation/tests/blu.test.js.bak"
rm -f "$BASE/automation/tests/blu.test.js.bak2"
rm -f "$BASE/automation/tests/blu_v3.test.js"

# 3. automation — remove stale JSON folder (already in knowledge_base)
echo "🗑️  Removing duplicate JSONs from automation/..."
rm -rf "$BASE/automation/JSON(s)"

# 4. automation — remove stale bak file
rm -f "$BASE/automation/run_config.json.bak"

# 5. dashboard — keep only v4 + server
echo "🗑️  Removing old dashboard versions..."
rm -f "$BASE/dashboard/blu_test_dashboard.html"
rm -f "$BASE/dashboard/blu_test_dashboard_v2.html"
rm -f "$BASE/dashboard/blu_test_dashboard_v3.html"

# 6. automation/test-output — keep only latest CSVs
echo "🗑️  Cleaning test-output..."
rm -f "$BASE/automation/test-output/blu_manual_test_cases.csv"
rm -f "$BASE/automation/test-output/blu_manual_test_cases_v1.csv"
rm -f "$BASE/automation/test-output/blu_manual_test_cases_v2.csv"
rm -f "$BASE/automation/test-output/blu_test_cases_v3.csv"
rm -f "$BASE/automation/test-output/blu_test_cases_v3_full.csv"
# Keep: blu_test_cases_v3_paraphrased.csv (master test cases)

# 7. Root test-output folder — move gap CSVs into automation/test-output
echo "📦 Moving gap CSVs..."
mv "$BASE/test-output/gaps_excel_not_in_json.csv" "$BASE/automation/test-output/" 2>/dev/null || true
mv "$BASE/test-output/gaps_json_not_in_excel.csv" "$BASE/automation/test-output/" 2>/dev/null || true
rmdir "$BASE/test-output" 2>/dev/null || true

echo ""
echo "✅ Done. Final structure:"
find $BASE -maxdepth 3 \
  -not -path "*/node_modules/*" \
  -not -name ".DS_Store" \
  -not -path "*/.git/*" \
  -not -name "*.json" \
  | sort | grep -v "knowledge_base/JSONs"
