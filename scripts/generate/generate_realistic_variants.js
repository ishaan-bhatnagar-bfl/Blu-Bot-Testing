#!/usr/bin/env node
/**
 * generate_realistic_variants.js
 *
 * Rewrites V7 KB-verbatim test questions into realistic real-user phrasing.
 * Groups by L3 topic → sends batch to Ollama → outputs one variant per V7 case.
 *
 * Why: V7 questions match KB headings exactly → artificially high pass rates.
 * Real users are informal, terse, Hinglish-mixed, and never write like a KB.
 *
 * Output: automation/test-output/blu_test_cases_v7_realistic.csv
 *         Same columns as V7. Source = realistic_v1. In-KB or Gap = In-KB.
 *
 * Usage:
 *   node scripts/generate_realistic_variants.js
 *   node scripts/generate_realistic_variants.js --dry-run     # show first 10 without calling LLM
 *   node scripts/generate_realistic_variants.js --module EMI_Card_Service
 *   node scripts/generate_realistic_variants.js --limit 200   # cap total cases
 *
 * Prerequisites:
 *   ollama serve  (llama3.1-local must be registered)
 */

const fs   = require('fs')
const path = require('path')
const http = require('http')

// ── CONFIG ────────────────────────────────────────────────────────────────────
const INPUT_CSV  = path.join(__dirname, '..', '..', 'test-cases', 'v7', 'blu_test_cases_v7.csv')
const OUTPUT_CSV = path.join(__dirname, '..', '..', 'test-cases', 'v7', 'blu_test_cases_v7_realistic.csv')
const OLLAMA_MODEL   = 'llama3.1-local'
const OLLAMA_HOST    = 'localhost'
const OLLAMA_PORT    = 11434
const BATCH_SIZE     = 8    // questions per LLM call (keep prompt tight)
const TIMEOUT_MS     = 30000

// ── CLI ARGS ─────────────────────────────────────────────────────────────────
const args         = process.argv.slice(2)
const DRY_RUN      = args.includes('--dry-run')
const moduleFilter = args.includes('--module') ? args[args.indexOf('--module') + 1] : null
const limitArg     = args.includes('--limit')  ? parseInt(args[args.indexOf('--limit') + 1]) : null

// ── CSV HELPERS ───────────────────────────────────────────────────────────────
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

function loadCSV(filePath) {
  const lines  = fs.readFileSync(filePath, 'utf8').split('\n')
  const header = parseCSVLine(lines[0])
  const rows   = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const vals = parseCSVLine(lines[i])
    const row  = {}
    header.forEach((h, idx) => { row[h] = (vals[idx] || '').trim() })
    if (row['Test Question']) rows.push(row)
  }
  return { header, rows }
}

// ── OLLAMA ────────────────────────────────────────────────────────────────────
async function isOllamaUp() {
  return new Promise(resolve => {
    const req = http.get(
      { host: OLLAMA_HOST, port: OLLAMA_PORT, path: '/api/tags', timeout: 3000 },
      res => { resolve(res.statusCode === 200); res.resume() }
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:  OLLAMA_MODEL,
      prompt: `<s>[INST] ${prompt} [/INST]`,
      stream: false,
      options: { temperature: 0.7, num_predict: 400, top_p: 0.9 }
    })
    const req = http.request(
      {
        host: OLLAMA_HOST, port: OLLAMA_PORT,
        path: '/api/generate', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: TIMEOUT_MS,
      },
      res => {
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => {
          try { resolve(JSON.parse(data).response || '') }
          catch { reject(new Error('Parse failed')) }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
    req.write(body)
    req.end()
  })
}

// ── PROMPT BUILDER ────────────────────────────────────────────────────────────
function buildBatchPrompt(l3, module, questions) {
  const qList = questions.map((q, i) => `${i + 1}. ${q}`).join('\n')
  return `You are rewriting customer service test questions for BLU Bot (Bajaj Finance AI assistant, Indian NBFC).

Context: Module = ${module}, Topic = ${l3}

Task: Rewrite each question below into how a REAL Indian mobile app user would actually type it.
Rules:
- Be terse, informal, sometimes grammatically incorrect (real users type fast)
- Mix English with Hindi/Hinglish words occasionally (e.g. "mera EMI", "kab milega", "kya hoga")
- Remove formal phrases ("Could you please", "I would like to know", "Kindly inform me")
- Keep the core question intent — do not change what is being asked
- Each rewrite must be different in phrasing from the original
- Output ONLY a JSON array of strings, one per question, in the same order
- No preamble, no explanation, no markdown. Just the JSON array.

Original questions:
${qList}

Respond with ONLY a JSON array like: ["rewritten 1","rewritten 2",...]`
}

// ── PARSE LLM BATCH RESPONSE ──────────────────────────────────────────────────
function parseBatchResponse(raw, expectedCount) {
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return null
    while (parsed.length < expectedCount) parsed.push(null)
    return parsed.slice(0, expectedCount)
  } catch {
    return null
  }
}

// ── GROUP BY L3 ───────────────────────────────────────────────────────────────
function groupByL3(rows) {
  const groups = {}
  rows.forEach(row => {
    const key = `${row['Module']}|||${row['L3']}`
    if (!groups[key]) groups[key] = { module: row['Module'], l3: row['L3'], rows: [] }
    groups[key].rows.push(row)
  })
  return Object.values(groups)
}

// ── GENERATE ──────────────────────────────────────────────────────────────────
async function generateVariants(groups) {
  const outputRows = []
  let tcCounter    = 1
  const total      = groups.reduce((s, g) => s + g.rows.length, 0)
  let done         = 0

  for (const group of groups) {
    const { module, l3, rows } = group
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch     = rows.slice(i, i + BATCH_SIZE)
      const questions = batch.map(r => r['Test Question'])
      let rewrites    = null

      if (!DRY_RUN) {
        try {
          const raw = await callOllama(buildBatchPrompt(l3, module, questions))
          rewrites  = parseBatchResponse(raw, questions.length)
          if (!rewrites) console.warn(`  ⚠ Parse failed for ${l3} batch — using originals`)
        } catch (e) {
          console.warn(`  ⚠ LLM error for ${l3}: ${e.message} — using originals`)
        }
      }

      batch.forEach((row, idx) => {
        const rewritten = rewrites?.[idx] || row['Test Question']
        const tcId      = `RV_${String(tcCounter).padStart(5, '0')}`
        tcCounter++; done++
        outputRows.push({
          'TC ID':                tcId,
          'Module':               row['Module'],
          'L1':                   row['L1'],
          'L2':                   row['L2'],
          'L3':                   row['L3'],
          'Test Question':        rewritten,
          'Original Question':    row['Test Question'],
          'Expected Behaviour':   row['Expected Behaviour'],
          'Expected Key Phrases': row['Expected Key Phrases'],
          'CTA Expected':         row['CTA Expected'],
          'Type':                 row['Type'] || 'Service',
          'In-KB or Gap':         'In-KB',
          'Scoring Type':         'auto',
          'Source':               'realistic_v1',
        })
      })

      process.stdout.write(`\r  Progress: ${done}/${total} (${l3.substring(0,30)})          `)
      if (!DRY_RUN) await sleep(200)
    }
  }
  console.log('\n')
  return outputRows
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── WRITE CSV ─────────────────────────────────────────────────────────────────
function writeCSV(rows) {
  const headers = [
    'TC ID','Module','L1','L2','L3',
    'Test Question','Original Question','Expected Behaviour','Expected Key Phrases',
    'CTA Expected','Type','In-KB or Gap','Scoring Type','Source'
  ]
  const lines = [
    headers.map(escCSV).join(','),
    ...rows.map(row => headers.map(h => escCSV(row[h] || '')).join(','))
  ]
  fs.writeFileSync(OUTPUT_CSV, lines.join('\n'), 'utf8')
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔄 BLU Bot — Realistic Variant Generator')
  console.log(`   Input:  ${INPUT_CSV}`)
  console.log(`   Output: ${OUTPUT_CSV}`)
  if (DRY_RUN)      console.log('   Mode:   DRY RUN (no LLM calls — originals used)')
  if (moduleFilter) console.log(`   Filter: module = ${moduleFilter}`)
  if (limitArg)     console.log(`   Limit:  ${limitArg} cases`)
  console.log('')

  const { rows: allRows } = loadCSV(INPUT_CSV)
  console.log(`✅ Loaded ${allRows.length} cases from V7`)

  let rows = allRows.filter(r => {
    if ((r['In-KB or Gap'] || '').toLowerCase().includes('gap')) return false
    if (moduleFilter && r['Module'] !== moduleFilter)            return false
    return true
  })
  if (limitArg) rows = rows.slice(0, limitArg)
  console.log(`📋 ${rows.length} cases to rewrite (after filters)\n`)

  if (!DRY_RUN) {
    if (!up) {
      console.error('❌ Ollama not running. Start it with: ollama serve')
      console.error('   Or use --dry-run to test without LLM.')
      process.exit(1)
    }
    console.log(`🧠 Ollama available — using ${OLLAMA_MODEL}\n`)
  }

  const groups     = groupByL3(rows)
  console.log(`📦 ${groups.length} L3 groups\n`)

  const outputRows = await generateVariants(groups)
  writeCSV(outputRows)
  console.log(`✅ Written ${outputRows.length} realistic variants → ${OUTPUT_CSV}`)
  console.log('\nNext steps:')
  console.log('  1. Load blu_test_cases_v7_realistic.csv in dashboard')
  console.log('  2. Run bulk across your modules')
  console.log('  3. Compare pass rates vs V7 — gap = realistic drop\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
