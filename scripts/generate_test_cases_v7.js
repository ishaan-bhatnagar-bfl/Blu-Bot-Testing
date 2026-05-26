#!/usr/bin/env node
'use strict';

/**
 * BLU Test Case Generator v7.1
 *
 * Generates test cases from ALL modules in May 22 JSONs.
 * Covers: Flexi Loans, Term Loans, Wheels, LAFD, LAS, Cards, FD/SDP,
 *         Gold Loan, Home Loan, Microfinance, Business Secured, Insurance,
 *         Payments (UPI/BBPS/Wallets/FASTag), Profile, Rewards, Help & Support
 *
 * Strategy:
 *   1. Load all KB entries from May 22 JSONs (chatbot-flag=yes)
 *   2. For each entry: use KB question as utterance (verbatim)
 *   3. Deduplicate by question text
 *   4. Output CSV with dashboard-compatible columns
 *
 * Output: automation/test-output/blu_test_cases_v7.csv
 */

const fs   = require('fs');
const path = require('path');

const JSON_DIR  = path.resolve('knowledge_base/JSONs/May 22 - Latest Content');
const OUTPUT    = path.resolve('automation/test-output/blu_test_cases_v7.csv');

// ── MODULE MAP — complete mapping for all May 22 JSON L1::L2 combos ─────────
const MODULE_MAP = {
  // Flexi Loans
  'loan::personal flexi loan':                      'Flexi_Loan_PL_Service',
  'loan::professional & business flexi loan':       'Flexi_Loan_PL_Service',
  'loan::sme flexi loan':                           'Flexi_Loan_SME_Service',

  // Term Loans
  'loan::personal term loan':                       'Term_Loan_PL_Service',
  'loan::consumer loan':                            'Term_Loan_PL_Service',
  'loan::professional & business term loan':        'Term_Loan_PB_Service',

  // Wheels
  'loan::two wheeler loan':                         'Flexi_Loan_Wheels_Service',
  'loan::new car finance':                          'Flexi_Loan_Wheels_Service',
  'loan::used car loan':                            'Flexi_Loan_Wheels_Service',
  'loan::new tractor loan':                         'Flexi_Loan_Wheels_Service',
  'loan::used tractor loan':                        'Flexi_Loan_Wheels_Service',

  // Other Loans
  'loan::home loan':                                'Home_Loan_Service',
  'loan::gold loan':                                'Gold_Loan_Service',
  'loan::microfinance group loan':                  'Microfinance_Service',
  'loan::business secured loan':                    'Business_Secured_Loan_Service',
  'loan::loan against securities':                  'LAS_Service',
  'loan::loans against securities':                 'LAS_Service',

  // LAFD
  'loan::loan against fixed deposit':               'LAFD_Service',
  'deposits::loan against fixed deposit':           'LAFD_Service',
  'deposits::loans against fixed deposit':          'LAFD_Service',

  // Loan Payments
  'loan::loan payment services':                    'Loan_Payments_Service',
  'loan payments drawdown::loan payment services':  'Loan_Payments_Service',

  // Cards
  'cards::emi network card':                        'EMI_Card_Service',
  'cards::health emi network card':                 'EMI_Card_Service',
  'cards::bajaj finserv dbs co-branded credit card':           'Credit_Card_Service',
  'cards::bajaj finserv rbl bank co-branded credit card':      'Credit_Card_Service',
  'cards::bajaj finserv rbl co-branded credit card':           'Credit_Card_Service',
  'cards::bajaj finance dbs co-branded credit card':           'Credit_Card_Service',
  'cards::bajaj finance rbl co-branded credit card':           'Credit_Card_Service',

  // Deposits / FD / SDP
  'deposits::fixed deposit':                        'FD_SDP_Service',
  'deposits::sdp':                                  'FD_SDP_Service',
  'deposit::sdp':                                   'FD_SDP_Service',
  'deposits::systematic deposit plan':              'FD_SDP_Service',

  // Insurance
  'insurance::insurance services':                  'Insurance_Service',
  'insurance::genericinsurancequeries':             'Insurance_Service',
  'insurance::generic insurance queries':           'Insurance_Service',

  // Payments — UPI
  'upi::genericupiqueries':                         'Payments_UPI_Service',
  'upi::generic upi queries':                       'Payments_UPI_Service',
  'upi::p2p':                                       'Payments_UPI_Service',
  'upi::p2m':                                       'Payments_UPI_Service',
  'upi::earn':                                      'Payments_UPI_Service',

  // Payments — BBPS
  'bbps::bbps':                                     'Payments_BBPS_Service',
  'bbps::genericbbpsqueries':                       'Payments_BBPS_Service',
  'bbps::generic bbps queries':                     'Payments_BBPS_Service',

  // Payments — Wallets
  'wallets::bank transfer':                         'Payments_Wallets_Service',
  'wallets::bill payments':                         'Payments_Wallets_Service',
  'wallets::cashback':                              'Payments_Wallets_Service',
  'wallets::genericwalletsqueries':                 'Payments_Wallets_Service',
  'wallets::generic wallets queries':               'Payments_Wallets_Service',
  'wallets::gift card':                             'Payments_Wallets_Service',
  'wallets::interop p2m':                           'Payments_Wallets_Service',
  'wallets::interop p2p':                           'Payments_Wallets_Service',
  'wallets::online merchant':                       'Payments_Wallets_Service',
  'wallets::topup':                                 'Payments_Wallets_Service',
  'wallets::wallet to wallet transfer debit':       'Payments_Wallets_Service',

  // Payments — FASTag
  'fastag::fastag':                                 'Fastag_Service',
  'fastag::genericfastagqueries':                   'Fastag_Service',
  'fastag::generic fastag queries':                 'Fastag_Service',

  // Profile / DNC
  'profile details::profile services':             'Profile_Service',
  'profile details::genericdncqueries':            'Profile_Service',
  'profile details::generic dnc queries':          'Profile_Service',
  'profile details::do not call':                  'Profile_Service',

  // Rewards
  'rewards::burn':                                  'Rewards_Service',
  'rewards::earn':                                  'Rewards_Service',
  'rewards::earn rewards':                          'Rewards_Service',
  'rewards::general':                               'Rewards_Service',
  'rewards::redeem rewards':                        'Rewards_Service',
  'rewards::rewards':                               'Rewards_Service',

  // Generic / Help
  'loan::genericloanqueries':                       'Generic_Loan_Service',
  'loan::generic loan queries':                     'Generic_Loan_Service',
  'cards::genericcardsqueries':                     'Generic_Cards_Service',
  'cards::generic card queries':                    'Generic_Cards_Service',
  'deposits::genericdepositqueries':                'Generic_Deposits_Service',
  'deposits::generic deposit queries':              'Generic_Deposits_Service',

  // Others / Help & Support
  'others::help on raising a request':              'Help_Support',
  'others::document centre':                        'Help_Support',
  'others::kyc':                                    'Help_Support',
  'others::cibil':                                  'Help_Support',
  'others::key fact statement':                     'Help_Support',
  'others::mandate':                                'Help_Support',
  'others::others':                                 'Help_Support',
};

// Type classification for dashboard tab
function getType(module) {
  if (/Payments_|Fastag/.test(module)) return 'Payments';
  if (/Rewards/.test(module)) return 'Rewards';
  return 'Service';
}

function getModule(l1, l2) {
  const key = `${(l1||'').trim()}::${(l2||'').trim()}`.toLowerCase();
  return MODULE_MAP[key] || null;
}

function detectCTA(answer) {
  return /click here|tap here|apply|raise a request|document cent(er|re)|access and manage|bajajsuperapp:\/\//i.test(answer)
    ? 'Yes' : 'No';
}

function extractKeyPhrases(answer) {
  const clean = answer.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const ctaMatch = clean.match(/CTA Label:\s*([^,\n]+)/i);
  const phrases = [];
  if (ctaMatch) phrases.push(ctaMatch[1].trim());
  clean.split(/[.!?]/).slice(0, 2).forEach(s => {
    const words = s.trim().split(/\s+/);
    if (words.length >= 3 && words.length <= 14) phrases.push(s.trim());
  });
  return [...new Set(phrases)].slice(0, 3).join(' | ');
}

// ── LOAD ALL JSONs ────────────────────────────────────────────────────────────
console.log('\n🔧 BLU Test Case Generator v7.1\n');
console.log(`📂 Loading JSONs from: ${JSON_DIR}`);

if (!fs.existsSync(JSON_DIR)) {
  console.error(`❌ JSON directory not found: ${JSON_DIR}`);
  console.error('   Run from repo root: node scripts/generate_test_cases_v7.js');
  process.exit(1);
}

const jsonFiles = fs.readdirSync(JSON_DIR).filter(f => f.endsWith('.json'));
console.log(`   Found ${jsonFiles.length} JSON files`);

const entries = [];
const seen    = new Set();
const unmapped = new Set();

jsonFiles.forEach(file => {
  let content;
  try {
    content = JSON.parse(fs.readFileSync(path.join(JSON_DIR, file), 'utf-8'));
  } catch {
    console.warn(`   ⚠️  Skipping malformed: ${file}`);
    return;
  }

  content.forEach(entry => {
    const flag = (entry['chatbot-flag'] || '').toLowerCase().trim();
    if (flag !== 'yes') return;

    const l1       = (entry.l1category || '').trim();
    const l2       = (entry.l2category || '').trim();
    const l3       = (entry.l3category || '').trim();
    const question = (entry.question   || '').trim();
    const answer   = (entry.answer     || '').trim();

    if (!question || !answer) return;

    // Deduplicate
    const qKey = question.toLowerCase();
    if (seen.has(qKey)) return;
    seen.add(qKey);

    const module = getModule(l1, l2);
    if (!module) {
      unmapped.add(`${l1}::${l2}`);
      return;
    }

    entries.push({
      module, l1, l2, l3, question, answer,
      type:        getType(module),
      cta:         detectCTA(answer),
      key_phrases: extractKeyPhrases(answer),
    });
  });
});

console.log(`   Loaded: ${entries.length.toLocaleString()} entries`);
if (unmapped.size) {
  console.log(`   ⚠️  Unmapped L1::L2 combos (${unmapped.size}):`);
  [...unmapped].sort().forEach(u => console.log(`      ${u}`));
}

// ── SORT: module → l2 → l3 ───────────────────────────────────────────────────
entries.sort((a, b) => {
  if (a.module !== b.module) return a.module.localeCompare(b.module);
  if (a.l2 !== b.l2)         return a.l2.localeCompare(b.l2);
  return a.l3.localeCompare(b.l3);
});

// ── WRITE CSV ─────────────────────────────────────────────────────────────────
const headers = [
  'TC ID', 'Module', 'L1', 'L2', 'L3',
  'Test Question',       // dashboard key
  'Expected Behaviour',  // dashboard key
  'Expected Key Phrases',
  'CTA Expected',
  'Type',                // Service / Payments / Rewards
  'In-KB or Gap',        // always In-KB for verbatim
  'Scoring Type',
  'Source',
];

const esc = v => `"${String(v || '').replace(/"/g, '""')}"`;

const rows = entries.map((e, i) => [
  `TC_${String(i + 1).padStart(5, '0')}`,
  e.module,
  e.l1,
  e.l2,
  e.l3,
  e.question,            // Test Question
  e.answer,              // Expected Behaviour
  e.key_phrases,
  e.cta,
  e.type,
  'In-KB',
  'auto',
  'kb_verbatim_v7',
].map(esc).join(','));

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, [headers.map(esc).join(','), ...rows].join('\n'));

const mb = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(2);

// ── SUMMARY ───────────────────────────────────────────────────────────────────
const modCounts = {};
const typeCounts = {};
entries.forEach(e => {
  modCounts[e.module]  = (modCounts[e.module]  || 0) + 1;
  typeCounts[e.type]   = (typeCounts[e.type]   || 0) + 1;
});

console.log('\n' + '═'.repeat(60));
console.log('✅ BLU Test Cases v7.1 — Complete');
console.log('═'.repeat(60));
console.log(`\n📄 Output: ${OUTPUT} (${mb} MB)`);
console.log(`📊 Total:  ${entries.length.toLocaleString()} test cases\n`);

console.log('Type breakdown:');
Object.entries(typeCounts).sort((a,b) => b[1]-a[1]).forEach(([t,c]) =>
  console.log(`  ${t.padEnd(15)} ${c.toLocaleString()}`)
);

console.log('\nModule breakdown:');
Object.entries(modCounts).sort((a,b) => b[1]-a[1]).forEach(([m,c]) =>
  console.log(`  ${m.padEnd(35)} ${c.toLocaleString()}`)
);

console.log('\n' + '═'.repeat(60) + '\n');
