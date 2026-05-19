#!/usr/bin/env node
'use strict';

/**
 * BLU Test Case Generator v4.0
 *
 * Pipeline:
 *   1. Build ground truth index from all JSON files
 *   2. Map real user queries (CSV col A) to JSON entries via keyword overlap
 *   3. Select top 50 real user queries per L2 (by confidence desc)
 *   4. Gap-fill with JSON verbatim for any L3 with zero real user coverage
 *   5. Output blu_test_cases_v4.json
 */

const fs   = require('fs');
const path = require('path');

const JSON_DIR   = path.resolve('JSON(s)/May 07 - Latest Content');
const CSV_PATH   = path.resolve('data/3IN1 CHAT DATA DUMP.csv');
const OUTPUT_DIR = path.resolve('data');
const OUTPUT_JSON = path.join(OUTPUT_DIR, 'blu_test_cases_v4.json');

const MAX_REAL_USER_PER_L2 = 50;
const LOW_CONFIDENCE_THRESHOLD = 30; // below this → flagged for manual review

// ─── MODULE MAP ───────────────────────────────────────────────────────────────
// Key: "L1::L2" (lowercased for matching). Value: module tag.
// Handles known duplicates / typo variants.

const MODULE_MAP = {
  // Flexi Loans
  'loan::personal flexi loan':                      'Flexi_Loan_PL_Service',
  'loan::professional & business flexi loan':       'Flexi_Loan_PL_Service',
  'loan::sme flexi loan':                           'Flexi_Loan_SME_Service',

  // Flexi Wheels
  'loan::two wheeler loan':                         'Flexi_Loan_Wheels_Service',
  'loan::new car finance':                          'Flexi_Loan_Wheels_Service',
  'loan::used car loan':                            'Flexi_Loan_Wheels_Service',
  'loan::new tractor loan':                         'Flexi_Loan_Wheels_Service',
  'loan::used tractor loan':                        'Flexi_Loan_Wheels_Service',

  // Term Loans
  'loan::personal term loan':                       'Term_Loan_PL_Service',
  'loan::consumer loan':                            'Term_Loan_PL_Service',
  'loan::professional & business term loan':        'Term_Loan_PB_Service',

  // Other Loan Products
  'loan::home loan':                                'Home_Loan_Service',
  'loan::gold loan':                                'Gold_Loan_Service',
  'loan::microfinance group loan':                  'Microfinance_Service',
  'loan::business secured loan':                    'Business_Secured_Loan_Service',
  'loan::loan against securities':                  'LAS_Service',
  'loan::loans against securities':                 'LAS_Service',

  // LAFD — appears under both Loan and Deposits
  'loan::loan against fixed deposit':               'LAFD_Service',
  'deposits::loan against fixed deposit':           'LAFD_Service',
  'deposits::loans against fixed deposit':          'LAFD_Service',

  // EMI Card & Health Card
  'cards::emi network card':                        'EMI_Card_Service',
  'cards::health emi network card':                 'EMI_Card_Service',

  // Co-branded Credit Cards (discontinued but still in service)
  'cards::bajaj finserv dbs co-branded credit card':           'Credit_Card_Service',
  'cards::bajaj finserv rbl bank co-branded credit card':      'Credit_Card_Service',
  'cards::bajaj finserv rbl co-branded credit card':           'Credit_Card_Service',

  // FD / SDP
  'deposits::fixed deposit':                        'FD_SDP_Service',
  'deposits::sdp':                                  'FD_SDP_Service',
  'deposit::sdp':                                   'FD_SDP_Service',

  // Insurance
  'insurance::insurance services':                  'Insurance_Service',
  'insurance::genericinsurancequeries':             'Insurance_Service',

  // Payments
  'upi::genericupiqueries':                         'Payments_UPI_Service',
  'upi::p2p':                                       'Payments_UPI_Service',
  'upi::p2m':                                       'Payments_UPI_Service',
  'upi::earn':                                      'Payments_UPI_Service',
  'bbps::bbps':                                     'Payments_BBPS_Service',
  'bbps::genericbbpsqueries':                       'Payments_BBPS_Service',
  'wallets::bank transfer':                         'Payments_Wallets_Service',
  'wallets::bill payments':                         'Payments_Wallets_Service',
  'wallets::cashback':                              'Payments_Wallets_Service',
  'wallets::genericwalletsqueries':                 'Payments_Wallets_Service',
  'wallets::gift card':                             'Payments_Wallets_Service',
  'wallets::interop p2m':                           'Payments_Wallets_Service',
  'wallets::interop p2p':                           'Payments_Wallets_Service',
  'wallets::online merchant':                       'Payments_Wallets_Service',
  'wallets::topup':                                 'Payments_Wallets_Service',
  'wallets::wallet to wallet transfer debit':       'Payments_Wallets_Service',
  'loan payments drawdown::loan payment services':  'Loan_Payments_Service',

  // Fastag
  'fastag::fastag':                                 'Fastag_Service',
  'fastag::genericfastagqueries':                   'Fastag_Service',

  // Profile / DNC
  'profile details::profile services':              'Profile_Service',
  'profile details::genericdncqueries':             'Profile_Service',

  // Rewards
  'rewards::burn':                                  'Rewards_Service',
  'rewards::earn':                                  'Rewards_Service',
  'rewards::earn rewards':                          'Rewards_Service',
  'rewards::general':                               'Rewards_Service',
  'rewards::redeem rewards':                        'Rewards_Service',

  // Generics
  'loan::genericloanqueries':                       'Generic_Loan_Service',
  'cards::genericcardsqueries':                     'Generic_Cards_Service',
  'deposits::genericdepositqueries':                'Generic_Deposits_Service',

  // Help & Support / Others
  'others::help on raising a request':              'Help_Support',
  'others::document centre':                        'Help_Support',
  'others::kyc':                                    'Help_Support',
  'others::cibil':                                  'Help_Support',
  'others::key fact statement':                     'Help_Support',
  'others::mandate':                                'Help_Support',
};

// ─── L1 KEYWORD INFERENCE ────────────────────────────────────────────────────
// Used to infer L1 from a raw user query when no label exists in CSV.

const L1_KEYWORDS = {
  'Loan': [
    'loan', 'emi', 'flexi', 'personal loan', 'home loan', 'gold loan',
    'two wheeler', 'tractor', 'car finance', 'foreclosure', 'part payment',
    'kfs', 'key fact', 'noc', 'no dues', 'interest certificate', 'statement',
    'tenure', 'disburs', 'lafd', 'las', 'microfinance', 'business loan',
    'secured loan', 'consumer loan', 'advance emi', 'upcoming emi',
  ],
  'Cards': [
    'emi card', 'insta emi', 'health card', 'network card', 'card block',
    'card unblock', 'card number', 'cvv', 'card details', 'credit card',
    'rbl', 'dbs', 'bajaj card', 'card active', 'card limit',
  ],
  'Deposits': [
    'fd', 'fixed deposit', 'sdp', 'maturity', 'deposit', 'renewal',
    'interest payout', 'cumulative',
  ],
  'Insurance': [
    'insurance', 'policy', 'premium', 'claim', 'cover', 'balic',
    'health insurance', 'life insurance',
  ],
  'UPI': [
    'upi', 'bhim', 'p2p', 'p2m', 'vpa', 'upi id', 'collect request',
  ],
  'BBPS': [
    'bbps', 'bill pay', 'electricity bill', 'recharge', 'broadband',
    'gas bill', 'water bill',
  ],
  'Wallets': [
    'wallet', 'topup', 'top up', 'cashback', 'gift card', 'interop',
    'online merchant', 'wallet transfer',
  ],
  'fastag': [
    'fastag', 'fas tag', 'toll', 'highway',
  ],
  'Profile Details': [
    'profile', 'mobile number change', 'address update', 'pan update',
    'name change', 'do not call', 'dnc', 'kyc',
  ],
  'Others': [
    'document centre', 'document center', 'cibil', 'mandate',
    'raise a request', 'complaint', 'grievance',
  ],
  'Rewards': [
    'reward', 'cashpoint', 'redeem', 'earn points', 'burn',
  ],
};

// ─── STOPWORDS ───────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','as','is','are','was','were','be','been','being','have',
  'has','had','do','does','did','will','would','should','could','may',
  'might','can','must','you','your','we','our','i','my','me','this',
  'that','these','those','it','its','not','no','yes','please','hi',
  'hello','sir','madam','bhai','ji','hai','ho','mera','meri','kya',
  'kaise','chahiye','ka','ki','ko','se','pe','par','aur','ya','nahi',
  'nahin','karo','kar','mere','apna','apni','wala','wali','abhi','kal',
  'aaj','theek','sahi','galat','bas','toh','bhi','sirf',
]);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function keywordOverlap(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setB = new Set(tokensB);
  const overlap = tokensA.filter(t => setB.has(t)).length;
  return Math.round((overlap / Math.max(tokensA.length, tokensB.length)) * 100);
}

function inferL1(query) {
  const lower = query.toLowerCase();
  const scores = {};
  for (const [l1, keywords] of Object.entries(L1_KEYWORDS)) {
    scores[l1] = keywords.filter(kw => lower.includes(kw)).length;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : null;
}

// Reject mappings where query is clearly about a different domain than the matched JSON entry.
// Prevents short/ambiguous queries (e.g. "bank account change") from mapping to wrong L2.
const CROSS_MODULE_REJECTS = [
  // Profile/mandate queries must not map to Cards or Loan
  { queryPattern: /mobile number change|number change|bank account change|account change|mandate change|change mobile|change bank/i,
    rejectL2:     /emi network card|health emi|personal flexi|two wheeler|consumer loan/i },
  // Pure UPI queries must not map to Loan
  { queryPattern: /upi|bhim|vpa|p2p transfer|p2m/i,
    rejectL2:     /personal flexi|consumer loan|two wheeler/i },
  // Pure wallet queries must not map to Loan
  { queryPattern: /wallet|topup|top up|cashback/i,
    rejectL2:     /personal flexi|consumer loan|gold loan/i },
  // BBPS / bill pay must not map to Loan or Cards
  { queryPattern: /electricity bill|gas bill|water bill|broadband bill|recharge/i,
    rejectL2:     /personal flexi|consumer loan|emi network card/i },
];

function isCrossModuleReject(query, matchedL2) {
  const lower = query.toLowerCase();
  const l2lower = matchedL2.toLowerCase();
  return CROSS_MODULE_REJECTS.some(rule =>
    rule.queryPattern.test(lower) && rule.rejectL2.test(l2lower)
  );
}

function isRelational(answer) {
  return /customer_data/i.test(answer) ||
         /check.*before.*answer/i.test(answer) ||
         /if.*status.*is/i.test(answer);
}

function extractKeyPhrases(answer) {
  // Strip HTML
  const clean = answer.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const phrases = [];

  // CTA label
  const ctaMatch = clean.match(/CTA Label:\s*([^,\n]+)/i);
  if (ctaMatch) phrases.push(ctaMatch[1].trim());

  // Specific product/action mentions (first 2 sentences)
  const sentences = clean.split(/[.!?]/).slice(0, 2);
  sentences.forEach(s => {
    const words = s.trim().split(/\s+/);
    if (words.length >= 3 && words.length <= 12) {
      phrases.push(s.trim());
    }
  });

  // Deduplicate and limit
  return [...new Set(phrases)].slice(0, 4);
}

function extractCTA(answer) {
  const ctaMatch = answer.match(/CTA Label:\s*([^,\n]+)/i);
  if (!ctaMatch) {
    const hasImpliedCTA = /click here|tap here|visit.*page|document center|apply now|raise a request|get started|access and manage/i.test(answer);
    return {
      cta_expected: hasImpliedCTA ? 'Yes' : 'No',
      cta_label: '',
    };
  }
  return {
    cta_expected: 'Yes',
    cta_label: ctaMatch[1].trim(),
  };
}

function detectMultiTurn(answer) {
  return /please provide.*details|provide.*loan amount|specify.*product|which.*loan|which.*product|need.*following.*information/i.test(answer);
}

function getModule(l1, l2) {
  const key = `${l1}::${l2}`.toLowerCase();
  return MODULE_MAP[key] || 'Other';
}

// ─── STEP 1: Build JSON ground truth index ───────────────────────────────────

console.log('\n🔧 BLU Test Case Generator v4.0\n');
console.log('📂 Step 1: Building JSON ground truth index...');

const jsonFiles = fs.readdirSync(JSON_DIR).filter(f => f.endsWith('.json'));
console.log(`   Found ${jsonFiles.length} JSON files`);

const groundTruth = []; // { l1, l2, l3, question, answer, module, tokens, ... }

jsonFiles.forEach(file => {
  let content;
  try {
    content = JSON.parse(fs.readFileSync(path.join(JSON_DIR, file), 'utf-8'));
  } catch (e) {
    console.warn(`   ⚠️  Skipping malformed JSON: ${file}`);
    return;
  }

  content.forEach(entry => {
    const flag = (entry['chatbot-flag'] || '').toLowerCase().trim();
    if (flag !== 'yes') return;

    const l1 = (entry.l1category || '').trim();
    const l2 = (entry.l2category || '').trim();
    const l3 = (entry.l3category || '').trim();
    const question = (entry.question || '').trim();
    const answer   = (entry.answer   || '').trim();

    if (!l1 || !question || !answer) return;

    const module = getModule(l1, l2);
    const { cta_expected, cta_label } = extractCTA(answer);

    groundTruth.push({
      l1, l2, l3, question, answer, module,
      tokens:          tokenize(question + ' ' + answer),
      question_tokens: tokenize(question),
      scoring_type:    isRelational(answer) ? 'manual' : 'auto',
      cta_expected,
      cta_label,
      is_multi_turn:   detectMultiTurn(answer),
      key_phrases:     extractKeyPhrases(answer),
    });
  });
});

console.log(`   Loaded ${groundTruth.length} ground truth entries`);

// ─── STEP 2: Load and map real user queries ───────────────────────────────────

console.log('\n📊 Step 2: Loading real user queries from CSV...');

let csvText;
try {
  csvText = fs.readFileSync(CSV_PATH, 'utf-8');
} catch (e) {
  console.error(`   ❌ CSV not found at ${CSV_PATH}`);
  console.error('   Place "3IN1 CHAT DATA DUMP.csv" in the data/ folder and rerun.');
  process.exit(1);
}

// Parse CSV — only column A (question). Handle quoted fields with embedded commas/newlines.
const rawQueries = [];
const lines = csvText.split('\n');
let inQuote = false;
let current = '';

for (let i = 1; i < lines.length; i++) { // skip header
  const line = lines[i];

  for (let c = 0; c < line.length; c++) {
    const ch = line[c];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      // End of column A
      const q = current.replace(/^"|"$/g, '').trim();
      if (q && q.length > 3) rawQueries.push(q);
      current = '';
      break; // only need col A
    } else {
      current += ch;
    }
  }
  if (inQuote) {
    current += '\n'; // multi-line quoted field
  } else {
    // Line ended without hitting comma — entire line is col A
    if (current.trim().length > 3) rawQueries.push(current.trim());
    current = '';
  }
}

// Deduplicate exact matches
const uniqueQueries = [...new Set(rawQueries)];
console.log(`   Raw queries: ${rawQueries.length.toLocaleString()}`);
console.log(`   Unique queries: ${uniqueQueries.length.toLocaleString()}`);

// ─── Map each query to best JSON match ───────────────────────────────────────

console.log('\n🔍 Step 3: Mapping queries to ground truth...');

const mappedQueries = []; // { utterance, matched_entry, confidence, inferred_l1 }
const unmapped = [];

let processed = 0;

uniqueQueries.forEach(query => {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return;

  const inferredL1 = inferL1(query);

  // Candidate pool: prefer same L1 if inferred, else all
  const candidates = inferredL1
    ? groundTruth.filter(e => e.l1 === inferredL1)
    : groundTruth;

  if (candidates.length === 0) {
    unmapped.push({ utterance: query, reason: 'No L1 match' });
    return;
  }

  let bestEntry = null;
  let bestScore = 0;

  for (const entry of candidates) {
    const score = keywordOverlap(queryTokens, entry.question_tokens);
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  if (!bestEntry) {
    unmapped.push({ utterance: query, reason: 'No keyword overlap' });
    return;
  }

  // Reject if query is clearly from a different domain than the matched L2
  if (isCrossModuleReject(query, bestEntry.l2)) {
    unmapped.push({ utterance: query, reason: 'Cross-module reject' });
    return;
  }

  mappedQueries.push({
    utterance:    query,
    matched:      bestEntry,
    confidence:   bestScore,
    inferred_l1:  inferredL1,
    mapping_type: bestScore >= LOW_CONFIDENCE_THRESHOLD ? 'real_user' : 'real_user_low_confidence',
  });

  processed++;
  if (processed % 5000 === 0) {
    console.log(`   Mapped ${processed.toLocaleString()} / ${uniqueQueries.length.toLocaleString()}...`);
  }
});

console.log(`   ✅ Mapped: ${mappedQueries.length.toLocaleString()}`);
console.log(`   ⚠️  Unmapped: ${unmapped.length.toLocaleString()}`);

// ─── STEP 4: Select top 50 per L2 ────────────────────────────────────────────

console.log('\n✂️  Step 4: Selecting top 50 per L2...');

// Group by L2
const byL2 = {};
mappedQueries.forEach(mq => {
  const key = `${mq.matched.l1}::${mq.matched.l2}`;
  if (!byL2[key]) byL2[key] = [];
  byL2[key].push(mq);
});

// Sort by confidence desc, take top 50
const selectedRealUser = [];
Object.entries(byL2).forEach(([key, items]) => {
  const top = items
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_REAL_USER_PER_L2);
  selectedRealUser.push(...top);
  console.log(`   ${key}: ${top.length} selected (from ${items.length})`);
});

console.log(`   Total real user selected: ${selectedRealUser.length.toLocaleString()}`);

// ─── STEP 5: Gap-fill with JSON verbatim ─────────────────────────────────────

console.log('\n📋 Step 5: Gap-filling with JSON verbatim...');

// Track which L3s already have real user coverage
const coveredL3s = new Set(
  selectedRealUser.map(mq => `${mq.matched.l1}::${mq.matched.l2}::${mq.matched.l3}`)
);

const verbatimCases = [];
groundTruth.forEach(entry => {
  const key = `${entry.l1}::${entry.l2}::${entry.l3}`;
  if (!coveredL3s.has(key)) {
    verbatimCases.push(entry);
    coveredL3s.add(key); // prevent duplicate verbatim per L3
  }
});

console.log(`   JSON verbatim gap-fill: ${verbatimCases.length} cases`);

// ─── STEP 6: Build final test cases ──────────────────────────────────────────

console.log('\n🏗️  Step 6: Building final test case objects...');

const testCases = [];
let tcID = 1;

// Real user cases
selectedRealUser.forEach(mq => {
  const e = mq.matched;
  testCases.push({
    id:                   `TC_${String(tcID++).padStart(5, '0')}`,
    module:               e.module,
    l1:                   e.l1,
    l2:                   e.l2,
    l3:                   e.l3,
    utterance:            mq.utterance,
    expected_answer:      e.answer,
    expected_key_phrases: e.key_phrases,
    cta_expected:         e.cta_expected,
    cta_label:            e.cta_label,
    scoring_type:         e.scoring_type,
    is_multi_turn:        e.is_multi_turn,
    mapping_type:         mq.mapping_type,
    mapping_confidence:   mq.confidence,
  });
});

// JSON verbatim gap-fill
verbatimCases.forEach(e => {
  testCases.push({
    id:                   `TC_${String(tcID++).padStart(5, '0')}`,
    module:               e.module,
    l1:                   e.l1,
    l2:                   e.l2,
    l3:                   e.l3,
    utterance:            e.question,
    expected_answer:      e.answer,
    expected_key_phrases: e.key_phrases,
    cta_expected:         e.cta_expected,
    cta_label:            e.cta_label,
    scoring_type:         e.scoring_type,
    is_multi_turn:        e.is_multi_turn,
    mapping_type:         'json_verbatim',
    mapping_confidence:   100,
  });
});

// Sort: module → l2 → l3 → mapping_type
testCases.sort((a, b) => {
  if (a.module !== b.module) return a.module.localeCompare(b.module);
  if (a.l2 !== b.l2) return a.l2.localeCompare(b.l2);
  if (a.l3 !== b.l3) return a.l3.localeCompare(b.l3);
  return a.mapping_type.localeCompare(b.mapping_type);
});

// Re-assign IDs after sort
testCases.forEach((tc, i) => {
  tc.id = `TC_${String(i + 1).padStart(5, '0')}`;
});

// ─── STEP 7: Write output ─────────────────────────────────────────────────────

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_JSON, JSON.stringify(testCases, null, 2));

const sizeMB = (fs.statSync(OUTPUT_JSON).size / 1024 / 1024).toFixed(2);

// Module distribution
const moduleCounts = {};
testCases.forEach(tc => {
  moduleCounts[tc.module] = (moduleCounts[tc.module] || 0) + 1;
});

const mappingCounts = {};
testCases.forEach(tc => {
  mappingCounts[tc.mapping_type] = (mappingCounts[tc.mapping_type] || 0) + 1;
});

console.log('\n' + '═'.repeat(60));
console.log('✅ BLU Test Cases v4 — Generation Complete');
console.log('═'.repeat(60));
console.log(`\n📄 Output: ${OUTPUT_JSON} (${sizeMB} MB)`);
console.log(`📊 Total test cases: ${testCases.length.toLocaleString()}`);

console.log('\n📦 Mapping breakdown:');
Object.entries(mappingCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([type, count]) => {
    console.log(`   ${type.padEnd(35)} ${count.toLocaleString()}`);
  });

console.log('\n🗂️  Module breakdown:');
Object.entries(moduleCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([mod, count]) => {
    console.log(`   ${mod.padEnd(35)} ${count.toLocaleString()}`);
  });

console.log('\n' + '═'.repeat(60) + '\n');
