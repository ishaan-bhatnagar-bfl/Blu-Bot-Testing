/**
 * export_bugs.js — BLU Agent Bug Report Exporter
 *
 * Writes FAIL + REVIEW results to an Excel file ready for manual ADO entry.
 * Two sheets:
 *   1. Bug Report  — one row per FAIL/REVIEW case, ADO title pre-filled
 *   2. Summary     — per-module pass/fail/review totals
 *
 * Usage (from agent_server.js):
 *   const { exportBugs } = require('./export_bugs')
 *   const path = await exportBugs(results, env)
 */

const XLSX = require('xlsx')
const fs   = require('fs')
const path = require('path')

const LOGS_DIR = path.join(__dirname, '..', 'logs', 'agent_runs')

async function exportBugs(results, env) {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true })

  const ts       = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
  const filename = `bugs_${env}_${ts}.xlsx`
  const filepath = path.join(LOGS_DIR, filename)

  const wb = XLSX.utils.book_new()

  // ── Sheet 1: Bug Report ───────────────────────────────────────────────────
  // Only FAIL and REVIEW cases
  const bugRows = results.filter(r => r.verdict === 'FAIL' || r.verdict === 'REVIEW')

  const bugData = [
    // Header row
    [
      'ADO Title',
      'Verdict',
      'Module',
      'L3',
      'TC ID',
      'Test Question',
      'Bot Response',
      'Expected Behaviour',
      'Failed Rules',
      'Chat ID',
      'Environment',
      'Tested At',
      'Notes',
    ],
    // Data rows
    ...bugRows.map(r => {
      const shortModule = (r.module || '').replace(/_Service$/, '').replace(/_/g, ' ')
      const shortDesc   = (r.l3 || r.question || '').substring(0, 60)
      const adoTitle    = `CAI Team || WEB || ${env} || ${shortModule} — ${shortDesc}`
      return [
        adoTitle,
        r.verdict,
        r.module || '',
        r.l3 || '',
        r.tcId || '',
        r.question || '',
        r.response || '',
        r.expectedBehaviour || '',
        (r.failedRules || []).join(', '),
        r.chatId || '',
        env,
        r.testedAt || '',
        '',  // Notes column — blank for manual fill
      ]
    })
  ]

  const bugSheet = XLSX.utils.aoa_to_sheet(bugData)

  // Column widths
  bugSheet['!cols'] = [
    { wch: 80 },  // ADO Title
    { wch: 10 },  // Verdict
    { wch: 28 },  // Module
    { wch: 28 },  // L3
    { wch: 12 },  // TC ID
    { wch: 60 },  // Test Question
    { wch: 80 },  // Bot Response
    { wch: 80 },  // Expected Behaviour
    { wch: 40 },  // Failed Rules
    { wch: 22 },  // Chat ID
    { wch: 8  },  // Environment
    { wch: 22 },  // Tested At
    { wch: 30 },  // Notes
  ]

  // Freeze first row
  bugSheet['!freeze'] = { xSplit: 0, ySplit: 1 }

  XLSX.utils.book_append_sheet(wb, bugSheet, 'Bug Report')

  // ── Sheet 2: Summary ──────────────────────────────────────────────────────
  const moduleStats = {}
  results.forEach(r => {
    if (!moduleStats[r.module]) moduleStats[r.module] = { pass: 0, fail: 0, review: 0, total: 0 }
    moduleStats[r.module].total++
    if (r.verdict === 'PASS')   moduleStats[r.module].pass++
    else if (r.verdict === 'FAIL') moduleStats[r.module].fail++
    else                        moduleStats[r.module].review++
  })

  const summaryData = [
    ['Module', 'Total', 'PASS', 'FAIL', 'REVIEW', 'Pass Rate'],
    ...Object.entries(moduleStats).sort((a,b) => a[0].localeCompare(b[0])).map(([mod, s]) => [
      mod.replace(/_Service$/, '').replace(/_/g, ' '),
      s.total,
      s.pass,
      s.fail,
      s.review,
      s.total ? Math.round((s.pass / s.total) * 100) + '%' : '0%',
    ]),
    // Totals row
    [
      'TOTAL',
      results.length,
      results.filter(r => r.verdict === 'PASS').length,
      results.filter(r => r.verdict === 'FAIL').length,
      results.filter(r => r.verdict === 'REVIEW').length,
      results.length ? Math.round((results.filter(r => r.verdict === 'PASS').length / results.length) * 100) + '%' : '0%',
    ]
  ]

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
  summarySheet['!cols'] = [{ wch: 30 },{ wch: 8 },{ wch: 8 },{ wch: 8 },{ wch: 8 },{ wch: 10 }]
  summarySheet['!freeze'] = { xSplit: 0, ySplit: 1 }

  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary')

  // Write file
  XLSX.writeFile(wb, filepath)
  return filepath
}

module.exports = { exportBugs }
