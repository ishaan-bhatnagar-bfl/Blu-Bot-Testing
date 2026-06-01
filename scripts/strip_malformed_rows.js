/**
 * strip_malformed_rows.js
 * Removes rows from blu_test_cases_v7.csv where Module is not a valid _Service name.
 * These are rows where Expected Behaviour had unescaped commas causing column shift.
 */
const fs   = require('fs')
const path = require('path')

const V7 = path.join(__dirname, '../test-cases/v7/blu_test_cases_v7.csv')

function parseFullCSV(text) {
  const rows = []
  let row = [], field = '', inQuote = false, i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuote) {
      if (ch === '"') {
        if (text[i+1] === '"') { field += '"'; i += 2; continue }
        inQuote = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuote = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\r' && text[i+1] === '\n') { row.push(field); rows.push(row); row=[]; field=''; i+=2; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row=[]; field=''; i++; continue }
    field += ch; i++
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

function escCSV(v) { return `"${String(v||'').replace(/"/g,'""')}"` }

const VALID_MODULES = new Set([
  'Business_Secured_Loan_Service','Flexi_Loan_PL_Service','Flexi_Loan_SME_Service',
  'Flexi_Wheels_Service','Flexi_Loan_Wheels_Service','LAFD_Service',
  'EMI_Card_Service','Health_EMI_Card_Service','FD_SDP_Service',
  'Term_Loan_PL_Service','Term_Loan_PB_Service','LAS_Service','Insurance_Service',
  'Gold_Loan_Service','Microfinance_Service','Profile_Service','Credit_Card_Service',
  'Generic_Loan_Service','Generic_Cards_Service','Generic_Deposits_Service',
  'Payments_BBPS_Service','Payments_Wallets_Service','Payments_UPI_Service','Fastag_Service',
  'Help_Support','Rewards_Service','Home_Loan_Service',
])

const rows  = parseFullCSV(fs.readFileSync(V7, 'utf8'))
const hdr   = rows[0]
const modIdx= hdr.indexOf('Module')

let kept = 0, removed = 0
const out = [hdr]

for (let i = 1; i < rows.length; i++) {
  const r = rows[i]
  if (!r || r.every(v => !v.trim())) continue
  const mod = (r[modIdx] || '').trim()
  if (VALID_MODULES.has(mod)) { out.push(r); kept++ }
  else { removed++; if(removed <= 5) console.log(`  Removing: Module="${mod.substring(0,60)}"`) }
}

if (removed > 5) console.log(`  ... and ${removed-5} more`)

fs.writeFileSync(V7, out.map(r => r.map(escCSV).join(',')).join('\n'), 'utf8')
console.log(`\n✅ Done — kept ${kept}, removed ${removed} malformed rows`)
console.log(`   Total: ${out.length - 1} rows`)
