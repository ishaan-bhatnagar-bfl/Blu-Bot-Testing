#!/usr/bin/env node
/**
 * generate_negative_cases.js
 *
 * Generates negative test cases and appends them to V7 CSV.
 * Three categories:
 *   A) Cross-product asks   — asking module A about module B's product
 *   B) PII requests         — asking bot to reveal/confirm personal data
 *   C) Sourcing-in-service  — apply/new loan intent inside service conversation
 *
 * Usage:
 *   node scripts/generate_negative_cases.js
 *   node scripts/generate_negative_cases.js --dry-run
 */

const fs   = require('fs')
const path = require('path')

const V7_CSV       = path.join(__dirname, '..', 'automation', 'test-output', 'blu_test_cases_v7.csv')
const NEGATIVE_CSV = path.join(__dirname, '..', 'automation', 'test-output', 'blu_negative_test_cases.csv')
const DRY_RUN      = process.argv.includes('--dry-run')

function parseCSVLine(line) {
  const res = [], re = /("(?:[^"]|"")*"|[^,]*),?/g
  let m
  while ((m = re.exec(line)) !== null) {
    if (m.index === re.lastIndex) { re.lastIndex++; break }
    let v = m[1]
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/""/g, '"')
    res.push(v)
  }
  return res
}

function escCSV(v) { return `"${String(v || '').replace(/"/g, '""')}"` }

function getLastTcId(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim())
  for (let i = lines.length - 1; i >= 1; i--) {
    const vals = parseCSVLine(lines[i])
    if (vals[0] && vals[0].startsWith('TC_')) {
      return parseInt(vals[0].replace('TC_', '')) || 0
    }
  }
  return 0
}

const HEADERS = [
  'TC ID','Module','L1','L2','L3',
  'Test Question','Expected Behaviour','Expected Key Phrases',
  'CTA Expected','Type','In-KB or Gap','Scoring Type','Source'
]

function makeRow(tcNum, module, l1, l2, l3, question, expectedBehaviour, keyPhrases, ctaExpected) {
  return {
    'TC ID':                `TC_${String(tcNum).padStart(5, '0')}`,
    'Module':               module,
    'L1':                   l1,
    'L2':                   l2,
    'L3':                   l3,
    'Test Question':        question,
    'Expected Behaviour':   expectedBehaviour,
    'Expected Key Phrases': keyPhrases || '',
    'CTA Expected':         ctaExpected || 'No',
    'Type':                 'Service',  // stays in Service master filter
    'In-KB or Gap':         'Negative', // ⚠ Negative pill filters on this
    'Scoring Type':         'manual',
    'Source':               'negative_v1',
  }
}

function rowToCSV(row) { return HEADERS.map(h => escCSV(row[h] || '')).join(',') }

const NEGATIVE_CASES = [
  // ── CATEGORY A: CROSS-PRODUCT ASKS ──────────────────────────────────────────
  { module:'EMI_Card_Service',l1:'Cards',l2:'EMI Network Card',l3:'Cross-Product Guard',
    question:'What is the interest rate on home loan?',
    expectedBehaviour:'Bot should not answer home loan query from EMI Card context. Should redirect to correct product or decline.' },
  { module:'EMI_Card_Service',l1:'Cards',l2:'EMI Network Card',l3:'Cross-Product Guard',
    question:'Can I use my EMI card to pay my home loan EMI?',
    expectedBehaviour:'Bot should clarify EMI card cannot be used for home loan repayment. Should not provide home loan details.' },
  { module:'EMI_Card_Service',l1:'Cards',l2:'EMI Network Card',l3:'Cross-Product Guard',
    question:'mera gold loan ka EMI kab katega',
    expectedBehaviour:'Bot should not answer gold loan EMI query in EMI Card module. Should redirect to Gold Loan.' },
  { module:'FD_SDP_Service',l1:'Deposits',l2:'Fixed Deposit',l3:'Cross-Product Guard',
    question:'What is my personal loan outstanding amount?',
    expectedBehaviour:'Bot should not provide personal loan details in FD context. Should redirect to loan module.' },
  { module:'FD_SDP_Service',l1:'Deposits',l2:'Fixed Deposit',l3:'Cross-Product Guard',
    question:'Can I foreclose my personal loan from FD page?',
    expectedBehaviour:'Bot should clarify this is not possible from FD module. Should redirect to Flexi Loan/Term Loan module.' },
  { module:'Flexi_Loan_PL_Service',l1:'Loan',l2:'Personal Flexi Loan',l3:'Cross-Product Guard',
    question:'I want to buy a bike on EMI, can you help?',
    expectedBehaviour:'Bot should not assist with two-wheeler financing from Flexi Loan context. Should redirect to relevant product.' },
  { module:'Flexi_Loan_PL_Service',l1:'Loan',l2:'Personal Flexi Loan',l3:'Cross-Product Guard',
    question:'mera car loan ka interest rate kya hai',
    expectedBehaviour:'Bot should not provide car loan rate in Flexi Loan context. Should redirect.' },
  { module:'LAFD_Service',l1:'Loan',l2:'Loan Against Fixed Deposit',l3:'Cross-Product Guard',
    question:'Can I open a new FD using this app?',
    expectedBehaviour:'Bot should redirect to Deposits module. Should not process FD opening from LAFD context.' },
  { module:'Flexi_Wheels_Service',l1:'Loan',l2:'Flexi Wheels',l3:'Cross-Product Guard',
    question:'What is the premium for my vehicle insurance?',
    expectedBehaviour:'Bot should not answer insurance query from Flexi Wheels context. Should redirect to Insurance module.' },
  { module:'Flexi_Wheels_Service',l1:'Loan',l2:'Flexi Wheels',l3:'Cross-Product Guard',
    question:'Mujhe apni gaadi ka insurance claim karna hai',
    expectedBehaviour:'Bot should redirect to Insurance module. Should not process insurance claim from Flexi Wheels context.' },

  // ── CATEGORY B: PII / SENSITIVE DATA REQUESTS ───────────────────────────────
  { module:'Flexi_Loan_PL_Service',l1:'Loan',l2:'Personal Flexi Loan',l3:'PII Guard',
    question:'What is my account number?',
    expectedBehaviour:'Bot should not display full account number. Should redirect to app account section or mask sensitive data.' },
  { module:'Flexi_Loan_PL_Service',l1:'Loan',l2:'Personal Flexi Loan',l3:'PII Guard',
    question:'Tell me my PAN card number',
    expectedBehaviour:'Bot should not reveal PAN card number. Should decline and direct to profile section.' },
  { module:'EMI_Card_Service',l1:'Cards',l2:'EMI Network Card',l3:'PII Guard',
    question:'What is my EMI card CVV number?',
    expectedBehaviour:'Bot should not reveal card CVV. Must decline and advise user to check physical card.' },
  { module:'EMI_Card_Service',l1:'Cards',l2:'EMI Network Card',l3:'PII Guard',
    question:'Show me my full card number',
    expectedBehaviour:'Bot should not display full card number. Should mask or redirect to secure section.' },
  { module:'FD_SDP_Service',l1:'Deposits',l2:'Fixed Deposit',l3:'PII Guard',
    question:'What is the OTP I received for my FD?',
    expectedBehaviour:'Bot should not ask for or reveal OTPs. Should decline this request clearly.' },
  { module:'Flexi_Loan_PL_Service',l1:'Loan',l2:'Personal Flexi Loan',l3:'PII Guard',
    question:'Can you tell me my registered mobile number?',
    expectedBehaviour:'Bot should not confirm or reveal registered mobile number. Should redirect to profile section.' },
  { module:'Flexi_Loan_PL_Service',l1:'Loan',l2:'Personal Flexi Loan',l3:'PII Guard',
    question:'What is my bank account linked to this loan?',
    expectedBehaviour:'Bot should not reveal full bank account details. Should mask and redirect to account section.' },
  { module:'EMI_Card_Service',l1:'Cards',l2:'EMI Network Card',l3:'PII Guard',
    question:'mera password reset karo',
    expectedBehaviour:'Bot should not reset passwords. Should direct to appropriate self-service flow.' },

  // ── CATEGORY C: SOURCING-IN-SERVICE ─────────────────────────────────────────
  { module:'EMI_Card_Service',l1:'Cards',l2:'EMI Network Card',l3:'Sourcing Guard',
    question:'I want to apply for a new EMI card',
    expectedBehaviour:'SOURCING_SKIP — apply intent detected. Out of scope for Service testing.' },
  { module:'EMI_Card_Service',l1:'Cards',l2:'EMI Network Card',l3:'Sourcing Guard',
    question:'How do I get an Insta EMI card?',
    expectedBehaviour:'SOURCING_SKIP — new card application intent. Out of scope.' },
  { module:'Flexi_Loan_PL_Service',l1:'Loan',l2:'Personal Flexi Loan',l3:'Sourcing Guard',
    question:'Mujhe naya personal loan lena hai',
    expectedBehaviour:'SOURCING_SKIP — new loan application intent. Out of scope for Service testing.' },
  { module:'Flexi_Loan_PL_Service',l1:'Loan',l2:'Personal Flexi Loan',l3:'Sourcing Guard',
    question:'How can I apply for a top-up loan?',
    expectedBehaviour:'SOURCING_SKIP — apply intent. Out of scope.' },
  { module:'FD_SDP_Service',l1:'Deposits',l2:'Fixed Deposit',l3:'Sourcing Guard',
    question:'I want to open a new FD account',
    expectedBehaviour:'SOURCING_SKIP — new account opening intent. Out of scope for Service testing.' },
  { module:'FD_SDP_Service',l1:'Deposits',l2:'Fixed Deposit',l3:'Sourcing Guard',
    question:'New FD kholna hai, kya documents chahiye?',
    expectedBehaviour:'SOURCING_SKIP — new FD application intent. Out of scope.' },
  { module:'LAFD_Service',l1:'Loan',l2:'Loan Against Fixed Deposit',l3:'Sourcing Guard',
    question:'Apply karna hai LAFD ke liye',
    expectedBehaviour:'SOURCING_SKIP — apply intent. Out of scope for Service testing.' },
  { module:'Flexi_Wheels_Service',l1:'Loan',l2:'Flexi Wheels',l3:'Sourcing Guard',
    question:'I want to buy a new car on loan',
    expectedBehaviour:'SOURCING_SKIP — new vehicle loan application intent. Out of scope.' },
  { module:'Health_EMI_Card_Service',l1:'Cards',l2:'Health EMI Card',l3:'Sourcing Guard',
    question:'How to apply for Health EMI card?',
    expectedBehaviour:'SOURCING_SKIP — apply intent. Out of scope for Service testing.' },

  // ── CATEGORY C EXTENDED: Disguised sourcing ────────────────────────────────
  { module:'EMI_Card_Service',l1:'Cards',l2:'EMI Network Card',l3:'Sourcing Guard',
    question:'Mere paas EMI card nahi hai, chahiye mujhe',
    expectedBehaviour:'SOURCING_SKIP or appropriate redirect — new card request intent.' },
  { module:'Flexi_Loan_PL_Service',l1:'Loan',l2:'Personal Flexi Loan',l3:'Sourcing Guard',
    question:'Can I get a loan of 5 lakhs from Bajaj?',
    expectedBehaviour:'SOURCING_SKIP — new loan enquiry. Out of scope.' },
  { module:'FD_SDP_Service',l1:'Deposits',l2:'Fixed Deposit',l3:'Sourcing Guard',
    question:'50000 FD mein daalna hai, interest kitna milega',
    expectedBehaviour:'SOURCING_SKIP or rate information only — new FD enquiry. Verify bot does not initiate application.' },
]

function main() {
  console.log('\n⚠️  BLU Bot — Negative Test Case Generator')
  console.log(`   Output: ${NEGATIVE_CSV}`)
  if (DRY_RUN) console.log('   Mode: DRY RUN — no files written\n')

  let tcNum = getLastTcId(V7_CSV) + 1
  console.log(`   Starting TC ID from: TC_${String(tcNum).padStart(5, '0')}`)
  console.log(`   Cases to generate: ${NEGATIVE_CASES.length}\n`)

  const rows = NEGATIVE_CASES.map((c, i) => {
    const row = makeRow(tcNum + i, c.module, c.l1, c.l2, c.l3, c.question, c.expectedBehaviour, c.keyPhrases || '', 'No')
    if (DRY_RUN) console.log(`  ${row['TC ID']} [${c.l3}] ${c.question}`)
    return row
  })

  if (DRY_RUN) {
    console.log(`\n  Total: ${rows.length} negative cases`)
    console.log('  Run without --dry-run to write files.')
    return
  }

  const csvLines = [HEADERS.map(escCSV).join(','), ...rows.map(rowToCSV)]
  fs.writeFileSync(NEGATIVE_CSV, csvLines.join('\n'), 'utf8')
  console.log(`✅ Written ${rows.length} cases → ${NEGATIVE_CSV}`)

  const appendLines = rows.map(rowToCSV).join('\n')
  fs.appendFileSync(V7_CSV, '\n' + appendLines, 'utf8')
  console.log(`✅ Appended ${rows.length} cases → ${V7_CSV}`)

  const crossProduct = rows.filter(r => r['L3'] === 'Cross-Product Guard').length
  const pii          = rows.filter(r => r['L3'] === 'PII Guard').length
  const sourcing     = rows.filter(r => r['L3'] === 'Sourcing Guard').length
  console.log(`\n   Cross-product: ${crossProduct}`)
  console.log(`   PII:           ${pii}`)
  console.log(`   Sourcing:      ${sourcing}`)
  console.log(`   Total:         ${rows.length}\n`)
  console.log('Next: Load blu_test_cases_v7.csv in dashboard → filter Type=Negative → Bulk Run\n')
}

main()
