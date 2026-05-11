#!/usr/bin/env node
'use strict';

/**
 * BLU Test Case Generator v5.0
 *
 * Sources (priority order):
 *   1. New chat dump (Chat Dump_9_10_May.xlsx) - session-level mapping via bot replies
 *   2. Old CSV (3IN1 CHAT DATA DUMP.csv) - fills L2s with no new dump coverage
 *   3. KB verbatim - fills L3s with no real user coverage
 *
 * Ground truth KB:
 *   - JSON(s)/May 07 - Latest Content/ (all files)
 *   - data/Loan Knowledge Repository version-1.1.xlsx (merged, deduped)
 *   - data/Insurance Knowledge Repository version 1.1 1.xlsx (merged, deduped)
 *
 * Output: data/blu_test_cases_v5.json
 */

const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const JSON_DIR    = path.resolve('JSON(s)/May 07 - Latest Content');
const NEW_DUMP    = path.resolve('data/Chat Dump_9_10_May.xlsx');
const OLD_CSV     = path.resolve('data/3IN1 CHAT DATA DUMP.csv');
const LOAN_REPO   = path.resolve('data/Loan Knowledge Repository version-1.1.xlsx');
const INS_REPO    = path.resolve('data/Insurance Knowledge Repository version 1.1 1.xlsx');
const OUTPUT_JSON = path.resolve('data/blu_test_cases_v5.json');

const MAX_PER_L2         = 50;
const LOW_CONF_THRESHOLD = 30;

const MODULE_MAP = {
  'loan::personal flexi loan':                     'Flexi_Loan_PL_Service',
  'loan::professional & business flexi loan':      'Flexi_Loan_PL_Service',
  'loan::sme flexi loan':                          'Flexi_Loan_SME_Service',
  'loan::two wheeler loan':                        'Flexi_Loan_Wheels_Service',
  'loan::new car finance':                         'Flexi_Loan_Wheels_Service',
  'loan::used car loan':                           'Flexi_Loan_Wheels_Service',
  'loan::new tractor loan':                        'Flexi_Loan_Wheels_Service',
  'loan::used tractor loan':                       'Flexi_Loan_Wheels_Service',
  'loan::personal term loan':                      'Term_Loan_PL_Service',
  'loan::consumer loan':                           'Term_Loan_PL_Service',
  'loan::professional & business term loan':       'Term_Loan_PB_Service',
  'loan::home loan':                               'Home_Loan_Service',
  'loan::gold loan':                               'Gold_Loan_Service',
  'loan::microfinance group loan':                 'Microfinance_Service',
  'loan::business secured loan':                   'Business_Secured_Loan_Service',
  'loan::loan against securities':                 'LAS_Service',
  'loan::loans against securities':                'LAS_Service',
  'loan::loan against fixed deposit':              'LAFD_Service',
  'deposits::loan against fixed deposit':          'LAFD_Service',
  'deposits::loans against fixed deposit':         'LAFD_Service',
  'loan::loan payment services':                   'Loan_Payments_Service',
  'loan payments drawdown::loan payment services': 'Loan_Payments_Service',
  'cards::emi network card':                       'EMI_Card_Service',
  'cards::health emi network card':                'EMI_Card_Service',
  'cards::bajaj finserv dbs co-branded credit card':      'Credit_Card_Service',
  'cards::bajaj finserv rbl bank co-branded credit card': 'Credit_Card_Service',
  'cards::bajaj finserv rbl co-branded credit card':      'Credit_Card_Service',
  'deposits::fixed deposit':                       'FD_SDP_Service',
  'deposits::sdp':                                 'FD_SDP_Service',
  'deposit::sdp':                                  'FD_SDP_Service',
  'insurance::insurance services':                 'Insurance_Service',
  'insurance::genericinsurancequeries':            'Insurance_Service',
  'upi::genericupiqueries':                        'Payments_UPI_Service',
  'upi::p2p':                                      'Payments_UPI_Service',
  'upi::p2m':                                      'Payments_UPI_Service',
  'upi::earn':                                     'Payments_UPI_Service',
  'bbps::bbps':                                    'Payments_BBPS_Service',
  'bbps::genericbbpsqueries':                      'Payments_BBPS_Service',
  'wallets::bank transfer':                        'Payments_Wallets_Service',
  'wallets::bill payments':                        'Payments_Wallets_Service',
  'wallets::cashback':                             'Payments_Wallets_Service',
  'wallets::genericwalletsqueries':                'Payments_Wallets_Service',
  'wallets::gift card':                            'Payments_Wallets_Service',
  'wallets::interop p2m':                          'Payments_Wallets_Service',
  'wallets::interop p2p':                          'Payments_Wallets_Service',
  'wallets::online merchant':                      'Payments_Wallets_Service',
  'wallets::topup':                                'Payments_Wallets_Service',
  'wallets::wallet to wallet transfer debit':      'Payments_Wallets_Service',
  'fastag::fastag':                                'Fastag_Service',
  'fastag::genericfastagqueries':                  'Fastag_Service',
  'profile details::profile services':             'Profile_Service',
  'profile details::genericdncqueries':            'Profile_Service',
  'rewards::burn':                                 'Rewards_Service',
  'rewards::earn':                                 'Rewards_Service',
  'rewards::earn rewards':                         'Rewards_Service',
  'rewards::general':                              'Rewards_Service',
  'rewards::redeem rewards':                       'Rewards_Service',
  'loan::genericloanqueries':                      'Generic_Loan_Service',
  'cards::genericcardsqueries':                    'Generic_Cards_Service',
  'deposits::genericdepositqueries':               'Generic_Deposits_Service',
  'others::help on raising a request':             'Help_Support',
  'others::document centre':                       'Help_Support',
  'others::kyc':                                   'Help_Support',
  'others::cibil':                                 'Help_Support',
  'others::key fact statement':                    'Help_Support',
  'others::mandate':                               'Help_Support',
};

const L1_KEYWORDS = {
  'Loan': ['loan','emi','flexi','personal loan','home loan','gold loan','two wheeler',
    'tractor','car finance','foreclosure','part payment','kfs','key fact','noc',
    'no dues','interest certificate','statement','tenure','disburs','lafd','las',
    'microfinance','business loan','secured loan','consumer loan','advance emi','upcoming emi'],
  'Cards': ['emi card','insta emi','health card','network card','card block',
    'card unblock','card number','cvv','card details','credit card','rbl','dbs',
    'bajaj card','card active','card limit'],
  'Deposits': ['fd','fixed deposit','sdp','maturity','deposit','renewal','interest payout','cumulative'],
  'Insurance': ['insurance','policy','premium','claim','cover','balic','health insurance','life insurance'],
  'UPI': ['upi','bhim','p2p','p2m','vpa','upi id','collect request'],
  'BBPS': ['bbps','bill pay','electricity bill','recharge','broadband','gas bill','water bill'],
  'Wallets': ['wallet','topup','top up','cashback','gift card','interop','online merchant','wallet transfer'],
  'fastag': ['fastag','fas tag','toll','highway'],
  'Profile Details': ['profile','mobile number change','address update','pan update',
    'name change','do not call','dnc','kyc'],
  'Others': ['document centre','document center','cibil','mandate','raise a request','complaint','grievance'],
  'Rewards': ['reward','cashpoint','redeem','earn points','burn'],
};

const CROSS_MODULE_REJECTS = [
  { queryPattern: /mobile number change|number change|bank account change|account change|mandate change|change mobile|change bank/i,
    rejectL2: /emi network card|health emi|personal flexi|two wheeler|consumer loan/i },
  { queryPattern: /upi|bhim|vpa|p2p transfer|p2m/i,
    rejectL2: /personal flexi|consumer loan|two wheeler/i },
  { queryPattern: /wallet|topup|top up|cashback/i,
    rejectL2: /personal flexi|consumer loan|gold loan/i },
  { queryPattern: /electricity bill|gas bill|water bill|broadband bill|recharge/i,
    rejectL2: /personal flexi|consumer loan|emi network card/i },
];

function isCrossModuleReject(query, matchedL2) {
  const lower = query.toLowerCase();
  const l2lower = matchedL2.toLowerCase();
  return CROSS_MODULE_REJECTS.some(r => r.queryPattern.test(lower) && r.rejectL2.test(l2lower));
}

const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by','from',
  'as','is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','should','could','may','might','can','must','you','your','we',
  'our','i','my','me','this','that','these','those','it','its','not','no','yes',
  'please','hi','hello','sir','madam','bhai','ji','hai','ho','mera','meri','kya',
  'kaise','chahiye','ka','ki','ko','se','pe','par','aur','ya','nahi','nahin','karo',
  'kar','mere','apna','apni','wala','wali','abhi','kal','aaj','theek','sahi','galat',
  'bas','toh','bhi','sirf',
]);

function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function keywordOverlap(tokA, tokB) {
  if (!tokA.length || !tokB.length) return 0;
  const setB = new Set(tokB);
  const overlap = tokA.filter(t => setB.has(t)).length;
  return Math.round((overlap / Math.max(tokA.length, tokB.length)) * 100);
}

function inferL1(query) {
  const lower = query.toLowerCase();
  const scores = {};
  for (const [l1, kws] of Object.entries(L1_KEYWORDS)) {
    scores[l1] = kws.filter(kw => lower.includes(kw)).length;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : null;
}

function getModule(l1, l2) {
  return MODULE_MAP[(l1 + '::' + l2).toLowerCase()] || 'Other';
}

function isRelational(answer) {
  return /customer_data/i.test(answer) ||
    /check.*before.*answer/i.test(answer) ||
    /if.*status.*is/i.test(answer);
}

function extractKeyPhrases(answer) {
  const clean = answer.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const phrases = [];
  const ctaMatch = clean.match(/CTA Label:\s*([^,\n]+)/i);
  if (ctaMatch) phrases.push(ctaMatch[1].trim());
  clean.split(/[.!?]/).slice(0, 2).forEach(s => {
    const words = s.trim().split(/\s+/);
    if (words.length >= 3 && words.length <= 12) phrases.push(s.trim());
  });
  return [...new Set(phrases)].slice(0, 4);
}

function extractCTA(answer) {
  const ctaMatch = answer.match(/CTA Label:\s*([^,\n]+)/i);
  if (!ctaMatch) {
    const implied = /click here|tap here|visit.*page|document center|apply now|raise a request|get started|access and manage|navigate/i.test(answer);
    return { cta_expected: implied ? 'Yes' : 'No', cta_label: '' };
  }
  return { cta_expected: 'Yes', cta_label: ctaMatch[1].trim() };
}

function detectMultiTurn(answer) {
  return /please provide.*details|provide.*loan amount|specify.*product|which.*loan product/i.test(answer);
}

// ── STEP 1: Build KB ──────────────────────────────────────────────────────────

console.log('\n🔧 BLU Test Case Generator v5.0\n');
console.log('📂 Step 1: Building ground truth KB...');

const groundTruth = [];
const seenQuestions = new Set();

function addEntry(l1, l2, l3, question, answer, chatbotFlag) {
  const flag = (chatbotFlag || '').toLowerCase().trim();
  if (flag !== 'yes') return;
  if (!l1 || !question || !answer) return;
  const qKey = question.trim().toLowerCase();
  if (seenQuestions.has(qKey)) return;
  seenQuestions.add(qKey);
  const module = getModule(l1, l2);
  const { cta_expected, cta_label } = extractCTA(answer);
  groundTruth.push({
    l1: l1.trim(), l2: (l2 || '').trim(), l3: (l3 || '').trim(),
    question: question.trim(), answer: answer.trim(), module,
    tokens:          tokenize(question + ' ' + answer),
    question_tokens: tokenize(question),
    answer_tokens:   tokenize(answer),
    scoring_type: isRelational(answer) ? 'manual' : 'auto',
    cta_expected, cta_label,
    is_multi_turn: detectMultiTurn(answer),
    key_phrases:   extractKeyPhrases(answer),
  });
}

// Load JSONs
const jsonFiles = fs.readdirSync(JSON_DIR).filter(f => f.endsWith('.json'));
jsonFiles.forEach(file => {
  let content;
  try { content = JSON.parse(fs.readFileSync(path.join(JSON_DIR, file), 'utf-8')); }
  catch { console.warn('  Skip: ' + file); return; }
  content.forEach(e => addEntry(e.l1category, e.l2category, e.l3category, e.question, e.answer, e['chatbot-flag']));
});
console.log('  JSONs: ' + jsonFiles.length + ' files -> ' + groundTruth.length + ' entries');

// Merge Loan repo
const loanWb = XLSX.readFile(LOAN_REPO);
const loanRows = XLSX.utils.sheet_to_json(loanWb.Sheets[loanWb.SheetNames[0]], { header: 1 }).slice(1);
const beforeLoan = groundTruth.length;
loanRows.forEach(r => addEntry(r[0], r[1], r[2], r[3], r[4], r[6]));
console.log('  Loan repo: ' + loanRows.length + ' rows -> ' + (groundTruth.length - beforeLoan) + ' new');

// Merge Insurance repo
const insWb = XLSX.readFile(INS_REPO);
const insRows = XLSX.utils.sheet_to_json(insWb.Sheets[insWb.SheetNames[0]], { header: 1 }).slice(1);
const beforeIns = groundTruth.length;
insRows.forEach(r => addEntry(r[0], r[1], r[2], r[3], r[4], r[5]));
console.log('  Insurance repo: ' + insRows.length + ' rows -> ' + (groundTruth.length - beforeIns) + ' new');
console.log('  Total KB: ' + groundTruth.length);

// ── STEP 2: New chat dump — session-level mapping via bot replies ──────────────

console.log('\n📱 Step 2: New chat dump (session-level mapping)...');

const NOISE = /temporary issue|try again|what do you want to do today|please enter your mobile|please provide your 6 digit|please select the relation|hi user|hi, i'm blu/i;

const newDumpWb   = XLSX.readFile(NEW_DUMP);
const newDumpRows = XLSX.utils.sheet_to_json(newDumpWb.Sheets[newDumpWb.SheetNames[0]], { header: 1 }).slice(1);
const newDumpMapped = [];

newDumpRows.forEach(row => {
  const chatId = row[0];
  let entries;
  try { entries = JSON.parse(row[1]); } catch { return; }

  entries.forEach(entry => {
    const botPart  = entry.split('| Bot:');
    const botReply = botPart.length > 1 ? botPart[botPart.length - 1].trim() : '';
    const custParts  = entry.split('| Bot:')[0].split('| Customer:');
    const customerMsg = custParts.length > 1 ? custParts[custParts.length - 1].trim() : '';

    if (!customerMsg || !botReply) return;
    if (NOISE.test(customerMsg) || NOISE.test(botReply)) return;
    if (customerMsg.length < 4) return;

    const botTokens = tokenize(botReply);
    if (botTokens.length < 3) return;

    // Match bot reply against KB answers
    let bestEntry = null, bestScore = 0;
    for (const e of groundTruth) {
      const score = keywordOverlap(botTokens, e.answer_tokens);
      if (score > bestScore) { bestScore = score; bestEntry = e; }
    }

    if (!bestEntry || bestScore < 10) return;
    if (isCrossModuleReject(customerMsg, bestEntry.l2)) return;

    newDumpMapped.push({
      utterance:    customerMsg,
      matched:      bestEntry,
      confidence:   bestScore,
      chat_id:      chatId,
      mapping_type: bestScore >= LOW_CONF_THRESHOLD ? 'new_dump' : 'new_dump_low_confidence',
      source:       'new_chat_dump',
    });
  });
});

console.log('  Sessions: ' + newDumpRows.length + ' -> mapped: ' + newDumpMapped.length);

// ── STEP 3: Old CSV — gap-fill for L2s not covered by new dump ────────────────

console.log('\n📊 Step 3: Old CSV gap-fill...');

const coveredL2sByNewDump = new Set(newDumpMapped.map(m => m.matched.l1 + '::' + m.matched.l2));

let csvText = '';
try { csvText = fs.readFileSync(OLD_CSV, 'utf-8'); }
catch { console.log('  Old CSV not found — skipping'); }

const oldCsvQueries = [];
if (csvText) {
  const lines = csvText.split('\n');
  let inQuote = false, current = '';
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) {
        const q = current.replace(/^"|"$/g, '').trim();
        if (q && q.length > 3) oldCsvQueries.push(q);
        current = ''; break;
      } else { current += ch; }
    }
    if (!inQuote) {
      if (current.trim().length > 3) oldCsvQueries.push(current.trim());
      current = '';
    } else { current += '\n'; }
  }
}

const uniqueOldQueries = [...new Set(oldCsvQueries)];
console.log('  Unique old queries: ' + uniqueOldQueries.length.toLocaleString());

const oldCsvMapped = [];
let oldProcessed = 0;

uniqueOldQueries.forEach(query => {
  const qt = tokenize(query);
  if (!qt.length) return;
  const l1 = inferL1(query);
  const candidates = l1 ? groundTruth.filter(e => e.l1 === l1) : groundTruth;
  if (!candidates.length) return;

  let best = null, bestS = 0;
  for (const e of candidates) {
    const s = keywordOverlap(qt, e.question_tokens);
    if (s > bestS) { bestS = s; best = e; }
  }
  if (!best) return;
  if (isCrossModuleReject(query, best.l2)) return;
  if (coveredL2sByNewDump.has(best.l1 + '::' + best.l2)) return;

  oldCsvMapped.push({
    utterance:    query,
    matched:      best,
    confidence:   bestS,
    mapping_type: bestS >= LOW_CONF_THRESHOLD ? 'old_csv' : 'old_csv_low_confidence',
    source:       'old_csv',
  });

  oldProcessed++;
  if (oldProcessed % 10000 === 0) console.log('    ' + oldProcessed.toLocaleString() + '...');
});

console.log('  Old CSV mapped (gap-fill): ' + oldCsvMapped.length.toLocaleString());

// ── STEP 4: Select top 50 per L2 ─────────────────────────────────────────────

console.log('\n✂️  Step 4: Selecting top 50 per L2...');

const allMapped = [...newDumpMapped, ...oldCsvMapped];
const byL2 = {};
allMapped.forEach(mq => {
  const k = mq.matched.l1 + '::' + mq.matched.l2;
  if (!byL2[k]) byL2[k] = [];
  byL2[k].push(mq);
});

const selectedRealUser = [];
Object.entries(byL2).forEach(([key, items]) => {
  const sorted = items.sort((a, b) => {
    const an = a.source === 'new_chat_dump' ? 1 : 0;
    const bn = b.source === 'new_chat_dump' ? 1 : 0;
    if (bn !== an) return bn - an;
    return b.confidence - a.confidence;
  });
  const top = sorted.slice(0, MAX_PER_L2);
  selectedRealUser.push(...top);
  const nd = top.filter(t => t.source === 'new_chat_dump').length;
  console.log('  ' + key + ': ' + top.length + ' (new_dump:' + nd + ' old_csv:' + (top.length - nd) + ')');
});

console.log('  Total real user: ' + selectedRealUser.length.toLocaleString());

// ── STEP 5: KB verbatim gap-fill ─────────────────────────────────────────────

console.log('\n📋 Step 5: KB verbatim gap-fill...');

const coveredL3s = new Set(
  selectedRealUser.map(mq => mq.matched.l1 + '::' + mq.matched.l2 + '::' + mq.matched.l3)
);

const verbatimCases = [];
groundTruth.forEach(e => {
  const k = e.l1 + '::' + e.l2 + '::' + e.l3;
  if (!coveredL3s.has(k)) { verbatimCases.push(e); coveredL3s.add(k); }
});
console.log('  KB verbatim: ' + verbatimCases.length);

// ── STEP 6: Build + write ─────────────────────────────────────────────────────

console.log('\n🏗️  Step 6: Building test cases...');

const testCases = [];
let tcID = 1;

selectedRealUser.forEach(mq => {
  const e = mq.matched;
  testCases.push({
    id:                   'TC_' + String(tcID++).padStart(5, '0'),
    module:               e.module,
    l1: e.l1, l2: e.l2, l3: e.l3,
    utterance:            mq.utterance,
    expected_answer:      e.answer,
    expected_key_phrases: e.key_phrases,
    cta_expected:         e.cta_expected,
    cta_label:            e.cta_label,
    scoring_type:         e.scoring_type,
    is_multi_turn:        e.is_multi_turn,
    mapping_type:         mq.mapping_type,
    mapping_confidence:   mq.confidence,
    source:               mq.source,
    chat_id:              mq.chat_id || null,
  });
});

verbatimCases.forEach(e => {
  testCases.push({
    id:                   'TC_' + String(tcID++).padStart(5, '0'),
    module:               e.module,
    l1: e.l1, l2: e.l2, l3: e.l3,
    utterance:            e.question,
    expected_answer:      e.answer,
    expected_key_phrases: e.key_phrases,
    cta_expected:         e.cta_expected,
    cta_label:            e.cta_label,
    scoring_type:         e.scoring_type,
    is_multi_turn:        e.is_multi_turn,
    mapping_type:         'kb_verbatim',
    mapping_confidence:   100,
    source:               'knowledge_base',
    chat_id:              null,
  });
});

const pri = { new_dump: 0, new_dump_low_confidence: 1, old_csv: 2, old_csv_low_confidence: 3, kb_verbatim: 4 };
testCases.sort((a, b) => {
  if (a.module !== b.module) return a.module.localeCompare(b.module);
  if (a.l2 !== b.l2) return a.l2.localeCompare(b.l2);
  if (a.l3 !== b.l3) return a.l3.localeCompare(b.l3);
  return (pri[a.mapping_type] || 5) - (pri[b.mapping_type] || 5);
});
testCases.forEach((tc, i) => tc.id = 'TC_' + String(i + 1).padStart(5, '0'));

fs.writeFileSync(OUTPUT_JSON, JSON.stringify(testCases, null, 2));
const mb = (fs.statSync(OUTPUT_JSON).size / 1024 / 1024).toFixed(2);

const modC = {}, srcC = {}, mapC = {};
testCases.forEach(tc => {
  modC[tc.module]       = (modC[tc.module]       || 0) + 1;
  srcC[tc.source]       = (srcC[tc.source]       || 0) + 1;
  mapC[tc.mapping_type] = (mapC[tc.mapping_type] || 0) + 1;
});

console.log('\n' + '='.repeat(60));
console.log('BLU Test Cases v5 - Complete');
console.log('Output: ' + OUTPUT_JSON + ' (' + mb + ' MB)');
console.log('Total:  ' + testCases.length.toLocaleString() + ' test cases');
console.log('\nSource:');
Object.entries(srcC).sort((a,b) => b[1]-a[1]).forEach(([s,c]) => console.log('  ' + s.padEnd(25) + c));
console.log('\nMapping:');
Object.entries(mapC).sort((a,b) => b[1]-a[1]).forEach(([m,c]) => console.log('  ' + m.padEnd(35) + c));
console.log('\nModule:');
Object.entries(modC).sort((a,b) => b[1]-a[1]).forEach(([m,c]) => console.log('  ' + m.padEnd(35) + c));
console.log('='.repeat(60));
