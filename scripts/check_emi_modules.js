const fs = require('fs')
const path = require('path')

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

const lines = fs.readFileSync(path.join(__dirname, '../test-cases/v7/blu_test_cases_v7.csv'), 'utf8').split('\n')
const hdr = parseCSVLine(lines[0])
const modIdx = hdr.indexOf('Module')
const l2Idx  = hdr.indexOf('L2')
const qIdx   = hdr.indexOf('Test Question')

const counts = {}
const samples = {}

for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue
  const vals = parseCSVLine(lines[i])
  const mod  = vals[modIdx] || ''
  const l2   = vals[l2Idx]  || ''
  const q    = vals[qIdx]   || ''
  if (mod.toLowerCase().includes('emi') || mod.toLowerCase().includes('health')) {
    if (!counts[mod]) { counts[mod] = 0; samples[mod] = [] }
    counts[mod]++
    if (samples[mod].length < 3) samples[mod].push(`L2=${l2} | ${q.substring(0,60)}`)
  }
}

console.log('\nModules containing EMI or Health:')
Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([m,n]) => {
  console.log(`\n  ${m}: ${n} cases`)
  samples[m].forEach(s => console.log(`    - ${s}`))
})
