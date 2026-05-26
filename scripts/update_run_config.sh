#!/bin/bash
# Step 5 — Update run_config.json with new BLU-Automation paths
# Usage: bash ~/Desktop/BLU-Automation/scripts/update_run_config.sh

cat > ~/Desktop/BLU-Automation/automation/run_config.json << 'JSON'
{
  "version": "3.0",
  "updated": "2026-05-25",
  "environments": {
    "N2P": {
      "url": "https://bflaiassist-n2p.bajajfinserv.in/blu/?jid=blu",
      "mobile": "9953333141",
      "description": "Non-Production environment"
    },
    "UAT": {
      "url": "",
      "mobile": "9953333141",
      "description": "User Acceptance Testing"
    },
    "PROD": {
      "url": "",
      "mobile": "9953333141",
      "description": "Production — use with caution"
    }
  },
  "paths": {
    "knowledge_base_jsons":  "../knowledge_base/JSONs/May 22 - Latest Content",
    "knowledge_base_excels": "../knowledge_base/Excels",
    "data_chat_dump":        "../data/chat_dump",
    "data_search_dump":      "../data/search_dump",
    "data_seo_dump":         "../data/seo_dump",
    "test_output":           "./test-output",
    "screenshots":           "./test-output/screenshots",
    "dashboard":             "../dashboard",
    "scripts_python":        "../scripts",
    "scripts_js":            "./scripts"
  },
  "test_cases": {
    "master_csv":     "./test-output/blu_test_cases_v3_paraphrased.csv",
    "regression_csv": "./test-output/blu_regression_suite.csv",
    "edge_cases_csv": "./test-output/blu_edge_cases.csv",
    "gaps_csv":       "./test-output/gaps_excel_not_in_json.csv"
  },
  "playwright": {
    "timeout_ms": 20000,
    "slow_mo_ms": 60,
    "viewport": { "width": 480, "height": 900 },
    "auto_reset_after_msgs": 30,
    "response_stability_checks": 3,
    "response_poll_interval_ms": 800
  },
  "scoring": {
    "auto_score_enabled": true,
    "keyword_match_threshold": 0.5,
    "min_response_length": 80
  }
}
JSON

echo "✅ run_config.json written → ~/Desktop/BLU-Automation/automation/run_config.json"
