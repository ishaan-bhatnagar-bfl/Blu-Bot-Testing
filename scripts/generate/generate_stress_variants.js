#!/usr/bin/env node
/**
 * generate_stress_variants.js
 *
 * Generates stress test cases from V7 by rewriting questions into:
 *   1. Typo variants     — common typos, character swaps, missing spaces
 *   2. Abbreviations     — "emi crd", "txn failed", "acnt chng"
 *   3. Compound queries  — two questions combined in one message
 *   4. Past tense        — "my transaction failed" → "my transaction had failed yesterday"
 *   5. Terse/incomplete  — drop words, super short
 *
 * Uses Ollama (llama3.1-local) in batches of 4.
 * Output: test-cases/supplementary/blu_stress_test_cases.csv
 *
 * Usage:
 *   node scripts/generate/generate_stress_variants.js
 *   node scripts/generate/generate_stress_variants.js --dry-run
 *   node scripts/generate/generate_stress_variants.js --module EMI_Card_Service
 *   node scripts/generate/generate_stress_variants.js --limit 100
 */

const fs   = require('fs')
const path = require('path')
const http = require('http')

const INPUT_CSV  = path.join(__dirname, '..', '..', 'test-cases', 'v7', 'blu_test_cases_v7.csv')
const OUTPUT_CSV = path.join(__dirname, '..', '..', 'test-cases', 'supplementary', 'blu_stress_test_cases.csv')

const OLLAMA_MODEL = 'llama3.1-local'
const OLLAMA_PORT  = 11434
const BATCH_SIZE   = 4
const TIMEOUT_MS   = 45000

// ── CLI ARGS ──────────────────────────────────────────────────────────────────
const args         = process.argv.slice(2)
const DRY_RUN      = args.includes('--dry-run')
const moduleFilter = args.includes('--module') ? args[args.indexOf('--module') + 1] : null
const limitArg     = args.includes('--limit')  ? parseInt(args[args.indexOf('--limit') + 1]) : null

// Stress categories
const CATEGORIES = ['typo', 'abbreviation', 'compound', 'past_tense', 'terse']

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
  return rows
}

// ── OLLAMA ────────────────────────────────────────────────────────────────────
async function isOllamaUp() {
  return new Promise(resolve => {
    const req = http.get(
      { host: 'localhost', port: OLLAMA_PORT, path: '/api/tags', timeout: 3000 },
      res => { resolve(res.statusCode === 200); res.resume() }
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL, prompt, stream: false,
      options: { temperature: 0.7, num_predict: 350, top_p: 0.9 }
    })
    const req = http.request(
      {
        host: 'localhost', port: OLLAMA_PORT, path: '/api/generate', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: TIMEOUT_MS,
      },
      res => {
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => {
          try { resolve(JSON.parse(data).response || '') }
          catch { reject(new Error('Response parse failed')) }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
    req.write(body)
    req.end()
  })
}

// ── PROMPTS ───────────────────────────────────────────────────────────────────
function buildBatchPrompt(questions, category) {
  const count = questions.length
  const qList = questions.map((q, i) => `${i + 1}. ${q}`).join('\n')

  const instructions = {
    typo: `Rewrite with realistic typos (character swaps, missing letters, double letters, missing spaces). Keep meaning clear.
Example: "I want to block my emi card" → "i wan to blck my emi crd"`,

    abbreviation: `Rewrite using common Indian mobile user abbreviations and informal shorthand.
Example: "I want to check my transaction history" → "txn history kaise check karu" or "where is txn history"`,

    compound: `Combine two related questions into one message, as a real user might type both at once.
Example: "I want to block my emi card" → "I want to block my emi card and also how to unblock it later"`,

    past_tense: `Rewrite as if the user is describing something that already happened, with time references.
Example: "Why did my transaction fail?" → "my card transaction failed yesterday on amazon, what happened"`,

    terse: `Rewrite as an extremely short, incomplete query — just 2-4 words, like a mobile user typing quickly.
Example: "How can I change my mandate bank?" → "mandate change" or "bank account update karna"`,
  }

  return `Rewrite these ${count} customer service questions in the style described below. Output ONLY a JSON array of ${count} strings. No markdown, no explanation.

Style: ${instructions[category]}

${qList}

JSON array of ${count} rewrites:`
}

// ── PARSER ────────────────────────────────────────────────────────────────────
function parseBatchResponse(raw, expectedCount) {
  if (!raw || !raw.trim()) return null
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  try { const p = JSON.parse(cleaned); if (Array.isArray(p)) return normalise(p, expectedCount) } catch {}
  const arrMatch = cleaned.match(/\[[\s\S]*?\]/)
  if (arrMatch) { try { const p = JSON.parse(arrMatch[0]); if (Array.isArray(p)) return normalise(p, expectedCount) } catch {} }
  const sq = cleaned.replace(/'/g, '"')
  const sqMatch = sq.match(/\[[\s\S]*?\]/)
  if (sqMatch) { try { const p = JSON.parse(sqMatch[0]); if (Array.isArray(p)) return normalise(p, expectedCount) } catch {} }
  const numbered = cleaned.match(/^\d+\.\s+(.+)$/gm)
  if (numbered?.length) return normalise(numbered.map(l => l.replace(/^\d+\.\s+/, '').trim()), expectedCount)
  const lines = cleaned.split('\n').map(l => l.replace(/^[-•*"'\d.)\s]+/, '').replace(/["']$/, '').trim()).filter(l => l.length > 3 && l.length < 200)
  if (lines.length) return normalise(lines, expectedCount)
  return null
}

function normalise(arr, expectedCount) {
  const clean = arr.map(v => (typeof v === 'string' ? v.trim() : null)).filter(v => v && v.length > 1)
  if (!clean.length) return null
  while (clean.length < expectedCount) clean.push(null)
  return clean.slice(0, expectedCount)
}

// ── GENERATE ──────────────────────────────────────────────────────────────────
async function generateStressVariants(rows) {
  const outputRows = []
  let done = 0, parseOk = 0, parseFail = 0
  const total = rows.length * CATEGORIES.length

  for (const category of CATEGORIES) {
    process.stdout.write(`\n  Category: ${category}\n`)
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch     = rows.slice(i, i + BATCH_SIZE)
      const questions = batch.map(r => r['Test Question'])
      let rewrites    = null

      if (!DRY_RUN) {
        try {
          const raw   = await callOllama(buildBatchPrompt(questions, category))
          rewrites    = parseBatchResponse(raw, questions.length)
          if (rewrites) parseOk++
          else { parseFail++; process.stdout.write(`  ⚠ Parse failed for ${category} batch — using originals\n`) }
        } catch (e) {
          parseFail++
          process.stdout.write(`  ⚠ LLM error: ${e.message}\n`)
        }
      }

      batch.forEach((row, idx) => {
        const rewritten  = rewrites?.[idx] || row['Test Question']
        const isOriginal = !rewrites?.[idx]
        done++
        outputRows.push({
          'TC ID':                `ST_${String(outputRows.length + 1).padStart(5, '0')}`,
          'Module':               row['Module'],
          'L1':                   row['L1'],
          'L2':                   row['L2'],
          'L3':                   row['L3'],
          'Test Question':        rewritten,
          'Original Question':    row['Test Question'],
          'Stress Category':      category,
          'Expected Behaviour':   row['Expected Behaviour'],
          'Expected Key Phrases': row['Expected Key Phrases'],
          'CTA Expected':         row['CTA Expected'],
          'Type':                 row['Type'] || 'Service',
          'In-KB or Gap':         row['In-KB or Gap'] || 'In-KB',
          'Scoring Type':         'manual',
          'Source':               isOriginal ? `stress_${category}_fallback` : `stress_${category}`,
        })
      })

      process.stdout.write(`\r  Progress: ${done}/${total} | ✓ ${parseOk} batches | ✗ ${parseFail} fallback          `)
      if (!DRY_RUN) await new Promise(r => setTimeout(r, 150))
    }
  }

  console.log('\n')
  return { outputRows, parseOk, parseFail }
}

// ── WRITE ─────────────────────────────────────────────────────────────────────
function writeCSV(rows) {
  const headers = [
    'TC ID','Module','L1','L2','L3',
    'Test Question','Original Question','Stress Category',
    'Expected Behaviour','Expected Key Phrases','CTA Expected',
    'Type','In-KB or Gap','Scoring Type','Source'
  ]
  const lines = [
    headers.map(escCSV).join(','),
    ...rows.map(row => headers.map(h => escCSV(row[h] || '')).join(','))
  ]
  fs.writeFileSync(OUTPUT_CSV, lines.join('\n'), 'utf8')
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n💥 BLU Bot — Stress Variant Generator')
  console.log(`   Input:  ${INPUT_CSV}`)
  console.log(`   Output: ${OUTPUT_CSV}`)
  console.log(`   Categories: ${CATEGORIES.join(', ')}`)
  if (DRY_RUN)      console.log('   Mode: DRY RUN')
  if (moduleFilter) console.log(`   Filter: ${moduleFilter}`)
  if (limitArg)     console.log(`   Limit: ${limitArg} source cases`)
  console.log('')

  const allRows = loadCSV(INPUT_CSV)
  console.log(`✅ Loaded ${allRows.length} cases from V7`)

  let rows = allRows.filter(r => {
    if ((r['In-KB or Gap'] || '') === 'Negative') return false
    if (moduleFilter && r['Module'] !== moduleFilter) return false
    return true
  })

  // Sample evenly across modules for all-module runs
  // Take every Nth case so we get coverage across all L3 topics
  if (!moduleFilter && !limitArg) {
    const N = 3  // every 3rd case → ~33% of V7 = ~770 source cases × 5 categories = ~3,850 stress cases
    rows = rows.filter((_, idx) => idx % N === 0)
    console.log(`📋 Sampling every ${N}rd case: ${rows.length} source cases`)
  }

  if (limitArg) rows = rows.slice(0, limitArg)
  console.log(`📊 Generating ${rows.length * CATEGORIES.length} stress cases (${rows.length} × ${CATEGORIES.length} categories)\n`)

  if (!DRY_RUN) {
    const up = await isOllamaUp()
    if (!up) {
      console.error('❌ Ollama not running. Start with: ollama serve')
      process.exit(1)
    }
    console.log(`🧠 Ollama available — using ${OLLAMA_MODEL}\n`)
  }

  const { outputRows, parseOk, parseFail } = await generateStressVariants(rows)

  writeCSV(outputRows)

  const rewriteRate = parseOk + parseFail > 0 ? Math.round((parseOk / (parseOk + parseFail)) * 100) : 0
  console.log(`✅ Written ${outputRows.length} stress cases → ${OUTPUT_CSV}`)
  console.log(`📊 Rewrite rate: ${rewriteRate}% (${parseOk} batches rewritten, ${parseFail} fallback)`)
  console.log('\nCategories generated:')
  CATEGORIES.forEach(c => {
    const n = outputRows.filter(r => r['Stress Category'] === c).length
    console.log(`  ${c.padEnd(15)} ${n} cases`)
  })
  console.log(`\nNext: Load blu_stress_test_cases.csv in dashboard to run stress tests\n`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
