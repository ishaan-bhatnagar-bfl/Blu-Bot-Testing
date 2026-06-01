#!/usr/bin/env node
/**
 * agent_server.js — BLU Bot Autonomous Agent Server v1.0
 *
 * Express HTTP server on :3002 (dashboard stays on :3001 — both can run together).
 * Shares verdict_engine.js, llm_verdict.js, semantic_scorer.js with the dashboard.
 * All Playwright primitives copied verbatim from playwright_server.js — zero drift.
 *
 * Endpoints:
 *   POST /start    { env, mobile, modules[], suite, casesPerModule }
 *   GET  /status   → { state, progress, awaiting_otp, results, log }
 *   POST /otp      { otp } — submit OTP for N2P login or re-auth
 *   POST /stop     — cancel current run
 *   GET  /modules  — list all available modules from the test CSV
 */

const { chromium }   = require('playwright')
const express        = require('express')
const cors           = require('cors')
const fs             = require('fs')
const path           = require('path')

const { runVerdict }                                     = require('../dashboard/verdict_engine')
const { runLLMVerdict, isOllamaAvailable, hybridVerdict } = require('../dashboard/llm_verdict')
const { exportBugs }                                     = require('./export_bugs')

// ── PATHS ─────────────────────────────────────────────────────────────────────
const V7_CSV         = path.join(__dirname, '..', 'test-cases', 'v7', 'blu_test_cases_v7.csv')
const REALISTIC_CSV  = path.join(__dirname, '..', 'test-cases', 'v7', 'blu_test_cases_v7_realistic.csv')
const LOGS_DIR       = path.join(__dirname, '..', 'logs', 'agent_runs')
const SCREENSHOTS_DIR= path.join(__dirname, '..', 'logs', 'screenshots')

const BOT_URLS = {
  N2P:  'https://bflaiassist-n2p.bajajfinserv.in/blu/?jid=blu',
  UAT:  'https://bflaiassist-uat.bajajfinserv.in/blu/?jid=blu',
}

const PORT = 3002

// ── STATE ─────────────────────────────────────────────────────────────────────
let browser, ctx, page
let agentState = {
  status:        'idle',     // idle | logging_in | awaiting_otp | running | awaiting_reauth_otp | done | stopped | error
  env:           'N2P',
  mobile:        '9953333141',
  modules:       [],
  suite:         'v7',
  casesPerModule:'all',
  progress:      { done: 0, total: 0, pass: 0, fail: 0, review: 0, currentModule: '', currentCase: '' },
  results:       [],         // all test results
  log:           [],         // terminal-style log lines
  error:         null,
  exportPath:    null,
  startedAt:     null,
  finishedAt:    null,
}
let stopRequested  = false
let otpResolve     = null   // resolves when OTP is submitted
let msgCount       = 0
let currentChatId  = null

function resetState() {
  agentState = {
    status: 'idle', env: 'N2P', mobile: '9953333141',
    modules: [], suite: 'v7', casesPerModule: 'all',
    progress: { done: 0, total: 0, pass: 0, fail: 0, review: 0, currentModule: '', currentCase: '' },
    results: [], log: [], error: null, exportPath: null, startedAt: null, finishedAt: null,
  }
  stopRequested = false
  otpResolve    = null
  msgCount      = 0
  currentChatId = null
}

function addLog(line) {
  const ts = new Date().toLocaleTimeString('en-IN')
  const entry = `[${ts}] ${line}`
  agentState.log.push(entry)
  if (agentState.log.length > 500) agentState.log = agentState.log.slice(-500)
  console.log(entry)
}

// ── CSV LOADER ────────────────────────────────────────────────────────────────
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

function loadCases(suite, modules, casesPerModule) {
  const csvPath = suite === 'realistic' ? REALISTIC_CSV : V7_CSV
  if (!fs.existsSync(csvPath)) throw new Error(`CSV not found: ${csvPath}`)
  const lines  = fs.readFileSync(csvPath, 'utf8').split('\n')
  const header = parseCSVLine(lines[0])
  const allRows = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const vals = parseCSVLine(lines[i])
    const row  = {}
    header.forEach((h, idx) => { row[h] = (vals[idx] || '').trim() })
    if (row['Test Question']) allRows.push(row)
  }
  // Filter to selected modules, skip Negative/Gap if not explicitly requested
  let filtered = allRows.filter(r => {
    if (!modules.includes(r['Module'])) return false
    if ((r['In-KB or Gap'] || '') === 'Negative') return false
    return true
  })
  // Cap per module
  if (casesPerModule && casesPerModule !== 'all') {
    const cap = parseInt(casesPerModule)
    const byModule = {}
    filtered.forEach(r => {
      if (!byModule[r['Module']]) byModule[r['Module']] = []
      if (byModule[r['Module']].length < cap) byModule[r['Module']].push(r)
    })
    filtered = Object.values(byModule).flat()
  }
  return filtered
}

function getAllModules(suite) {
  const csvPath = suite === 'realistic' ? REALISTIC_CSV : V7_CSV
  if (!fs.existsSync(csvPath)) return []
  const lines  = fs.readFileSync(csvPath, 'utf8').split('\n')
  const header = parseCSVLine(lines[0])
  const modIdx = header.indexOf('Module')
  if (modIdx === -1) return []
  const mods = new Set()
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const vals = parseCSVLine(lines[i])
    const mod  = (vals[modIdx] || '').trim()
    // Only accept valid module names — must end in _Service or be a known pattern
    if (mod && (mod.endsWith('_Service') || mod.endsWith('_Service2') || /^[A-Z][A-Za-z_]+Service$/.test(mod))) mods.add(mod)
  }
  return [...mods].sort()
}

// ── PLAYWRIGHT PRIMITIVES ─────────────────────────────────────────────────────
// Copied verbatim from playwright_server.js — same behaviour as dashboard

async function scrollToComposer() {
  try {
    await page.evaluate(() => {
      const fixTargets = ['.blu-bottom-glow','.blu-bottom-wrapper','[class*="bottom"]','[class*="input-wrap"]']
      fixTargets.forEach(sel => {
        const el = document.querySelector(sel)
        if (el) { el.style.overflow='visible';el.style.visibility='visible';el.style.opacity='1';el.style.zIndex='9999' }
      })
      const ta = document.querySelector('textarea')
      if (ta) { ta.style.visibility='visible';ta.style.opacity='1';ta.focus() }
    })
  } catch {}
}

async function getVisibleTextarea() {
  await page.waitForSelector('textarea', { timeout: 15000 }).catch(() => {})
  await scrollToComposer()
  await page.waitForTimeout(400)
  const visible = await page.evaluate(() => {
    const ta = document.querySelector('textarea')
    if (!ta) return false
    const rect = ta.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }).catch(() => false)
  if (!visible) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(800)
  }
  return 'textarea'
}

async function waitForBotToSettle(countBefore, maxMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    await page.waitForTimeout(800)
    const countNow = await page.evaluate(() =>
      document.querySelectorAll('div.blu-bot-message').length
    ).catch(() => 0)
    if (countNow > countBefore) break
  }
  let prev = '', stable = 0
  while (stable < 4 && Date.now() - start < maxMs) {
    await page.waitForTimeout(1000)
    const snapshot = await page.evaluate(() => {
      const msgs = Array.from(document.querySelectorAll('div.blu-bot-message'))
      return msgs.map(m => m.innerText.trim()).join('|||')
    }).catch(() => '')
    const lastPart = snapshot.split('|||').pop() || ''
    const loading  = ['hold on','please wait','checking','just a moment','fetching','kindly wait']
    if (loading.some(p => lastPart.toLowerCase().startsWith(p))) { stable=0;prev=snapshot;continue }
    if (snapshot === prev && snapshot.length > 0) stable++
    else { stable=0;prev=snapshot }
  }
  return true
}

async function dismissRetryCard(maxWaitMs = 45000) {
  const start = Date.now()
  let retryDetected = false
  while (Date.now() - start < maxWaitMs) {
    const s = await page.evaluate(() => {
      const bodyText = document.body.innerText || ''
      if (!/we.re facing a temporary issue/i.test(bodyText)) return { hasRetry: false }
      const btns    = Array.from(document.querySelectorAll('button')).filter(b => /^retry$/i.test(b.innerText.trim()))
      const active  = btns.find(b => !b.disabled && b.offsetParent !== null)
      const cdEl    = document.querySelector('[class*="countdown"],[class*="remaining"]')
      return { hasRetry: true, canClick: !!active, countdown: cdEl?.innerText?.trim() || '' }
    }).catch(() => ({ hasRetry: false }))
    if (!s.hasRetry) { if (retryDetected) addLog('✅ Retry card dismissed'); return true }
    retryDetected = true
    if (s.canClick) {
      addLog('🔄 Retry card — clicking Retry')
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(b=>/^retry$/i.test(b.innerText.trim())&&!b.disabled&&b.offsetParent!==null)
        if (b) b.click()
      })
      await page.waitForTimeout(2000)
      const still = await page.evaluate(() => /we.re facing a temporary issue/i.test(document.body.innerText||'')).catch(()=>false)
      if (!still) { addLog('✅ Retry card dismissed'); return true }
    } else {
      if (s.countdown) addLog(`⏳ Retry countdown: ${s.countdown}`)
      await page.waitForTimeout(3000)
    }
  }
  addLog('⚠️ Retry card did not dismiss — proceeding')
  return false
}

async function typeAndSend(text, waitForResponse = true) {
  try {
    await dismissRetryCard()
    const sel         = await getVisibleTextarea()
    const countBefore = await page.evaluate(() => document.querySelectorAll('div.blu-bot-message').length).catch(() => 0)
    await page.click(sel)
    await page.waitForTimeout(150)
    await page.fill(sel, text)
    await page.waitForTimeout(150)
    await page.keyboard.press('Enter')
    msgCount++
    if (waitForResponse) await waitForBotToSettle(countBefore)
    return true
  } catch (e) { addLog('⚠️ typeAndSend failed: ' + e.message); return false }
}

async function captureChatId() {
  try {
    const bluHeader = await page.$('.blu-header-title,.blu-header-wrapper,h1,.blu-header-title h1')
    if (bluHeader) {
      await page.context().grantPermissions(['clipboard-read','clipboard-write'])
      await bluHeader.click()
      await page.waitForTimeout(1000)
      const clipText = await page.evaluate(async () => {
        try { return await navigator.clipboard.readText() } catch { return null }
      })
      if (clipText) {
        try {
          const parsed = JSON.parse(clipText)
          if (parsed.chatId) { currentChatId = parsed.chatId; return currentChatId }
        } catch {
          if (clipText.length > 5 && clipText.length < 50 && !clipText.includes(' ')) {
            currentChatId = clipText.trim(); return currentChatId
          }
        }
      }
    }
  } catch {}
  return currentChatId
}

function detectHinglish(text) {
  const words = ['karo','karna','chahiye','hai','hain','nahi','nhin','aap','mera','meri','muje','apna','apni','bata','dena','lena','milega','hoga','karega','karein','kijiye','dijiye','batao','dekho','suno','theek','bilkul','zaroor','krna','pata','kaise','kitna']
  const lower = text.toLowerCase()
  return words.filter(w => lower.includes(w)).length >= 2
}

async function getNewBotResponses(countBefore) {
  const LOADING = ['hold on','please wait','checking','just a moment','fetching','kindly wait']
  let loadWait = 0
  while (loadWait < 20000) {
    const lastText = await page.evaluate(() => {
      const msgs = document.querySelectorAll('div.blu-bot-message')
      return msgs[msgs.length-1]?.innerText?.trim().toLowerCase() || ''
    }).catch(() => '')
    if (!LOADING.some(p => lastText.startsWith(p))) break
    await page.waitForTimeout(1500); loadWait += 1500
  }
  try {
    const result = await page.evaluate((before) => {
      const allBotMsgs = Array.from(document.querySelectorAll('div.blu-bot-message'))
      const newBubbles = allBotMsgs.slice(before)
      if (!newBubbles.length) newBubbles.push(allBotMsgs[allBotMsgs.length-1])
      const texts = newBubbles.flatMap(bubble => {
        const ps = Array.from(bubble.querySelectorAll('p.blu-text-message-text')).map(p=>p.innerText.trim()).filter(Boolean)
        return ps.length ? ps : [bubble.innerText.trim()]
      }).filter(Boolean)
      const text      = texts.join('\n\n')
      const ctaEls    = newBubbles.flatMap(b=>Array.from(b.querySelectorAll('a,button[class*="cta"],div[class*="cta"],[onclick*="bajaj"],[href]')))
      const ctaItems  = ctaEls.map(el => {
        const label   = el.innerText.trim()
        const href    = el.getAttribute('href') || ''
        const onclick = el.getAttribute('onclick') || ''
        const deepMatch = (href+' '+onclick).match(/bajajsuperapp:\/\/[^\s"')]+/)
        const link    = deepMatch ? deepMatch[0] : (href&&href!=='#'?href:'')
        return label ? { label, link } : null
      }).filter(Boolean)
      return { text, hasCTA: ctaItems.length>0, ctaLabels: ctaItems.map(c=>c.label), ctaLinks: ctaItems.map(c=>c.link) }
    }, countBefore)
    return { response: result.text || '(response not captured)', hasCTA: result.hasCTA, ctaLabels: result.ctaLabels, ctaLinks: result.ctaLinks, isHinglish: detectHinglish(result.text) }
  } catch (e) { addLog('⚠️ Response capture error: ' + e.message) }
  return { response: '(response not captured)', hasCTA: false, ctaLabels: [], ctaLinks: [], isHinglish: false }
}

async function isBotOnLoginScreen() {
  return page.evaluate(() => {
    const textarea  = document.querySelector('textarea')
    if (!textarea) return false
    const botMsgs   = document.querySelectorAll('div.blu-bot-message')
    if (botMsgs.length > 1) return false
    const lastBotText = botMsgs[botMsgs.length-1]?.innerText?.trim() || ''
    return /please enter your mobile number/i.test(lastBotText) && textarea.value.trim()==='' && textarea.offsetParent!==null
  }).catch(() => false)
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
async function doLogin(env, mobile) {
  agentState.status = 'logging_in'
  agentState.env    = env
  agentState.mobile = mobile
  const url = BOT_URLS[env]
  addLog(`🌐 Navigating to ${env}: ${url}`)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  await scrollToComposer()
  addLog(`📱 Sending mobile: ${mobile}`)
  await typeAndSend(mobile, true)
  if (env === 'UAT') {
    addLog('🔑 UAT — auto-sending OTP: 123465')
    await typeAndSend('123465', true)
    await page.waitForTimeout(2000)
    await captureChatId()
    agentState.status = 'running'
    addLog('✅ UAT login complete')
  } else {
    agentState.status = 'awaiting_otp'
    addLog('📲 N2P — waiting for OTP input...')
  }
}

// ── OTP SUBMISSION ────────────────────────────────────────────────────────────
async function submitOTPValue(otp) {
  addLog(`🔑 Submitting OTP: ${otp}`)
  await typeAndSend(otp, true)
  await page.waitForTimeout(2000)
  await captureChatId()
  addLog('✅ Login complete')
  if (otpResolve) { otpResolve(otp); otpResolve = null }
}

// ── RE-AUTH ───────────────────────────────────────────────────────────────────
async function reAuthIfNeeded() {
  const onLogin = await isBotOnLoginScreen()
  if (!onLogin) return false
  addLog('🔑 Session reset — re-authenticating')
  await typeAndSend(agentState.mobile, true)
  await page.waitForTimeout(1000)
  if (agentState.env === 'UAT') {
    await typeAndSend('123465', true)
  } else {
    agentState.status = 'awaiting_reauth_otp'
    addLog('📲 N2P re-auth — enter OTP in browser or submit via UI')
    await new Promise(resolve => { otpResolve = resolve })
    agentState.status = 'running'
  }
  await page.waitForTimeout(2000)
  await captureChatId()
  msgCount = 0
  addLog('✅ Re-auth complete')
  return true
}

// ── RUN ONE CASE ──────────────────────────────────────────────────────────────
async function runCase(row) {
  const question          = row['Test Question']
  const expectedBehaviour = row['Expected Behaviour'] || ''
  const module            = row['Module'] || ''
  const l3                = row['L3'] || ''
  const tcId              = row['TC ID'] || ''
  const sendStart         = Date.now()

  await reAuthIfNeeded()

  const countBefore = await page.evaluate(() =>
    document.querySelectorAll('div.blu-bot-message').length
  ).catch(() => 0)

  const ok = await typeAndSend(question, true)
  if (!ok) {
    const verdict = runVerdict({ question, response: '', module, expectedBehaviour })
    return makeResult({ tcId, module, l3, question, expectedBehaviour, response: '(send failed)', verdict, failedRules: ['SEND_FAILED'] })
  }

  let result = await getNewBotResponses(countBefore)

  // FIX #3: detect "number of attempts exceeded" — stop entire run
  if (/number of attempts exceeded|cannot proceed with your request/i.test(result.response)) {
    addLog('🚫 Bot rate-limited: "Number of attempts exceeded" — stopping run')
    stopRequested = true
    return makeResult({ tcId, module, l3, question, expectedBehaviour, response: result.response, verdict: runVerdict({ question, response: result.response, module, expectedBehaviour }), failedRules: ['RATE_LIMITED'] })
  }

  // Loading state — poll up to 3x with 4s gaps
  const LOADING_PAT = /working on it|hold on|please wait|kindly wait|checking|fetching|just a moment|one moment|processing/i
  if (LOADING_PAT.test(result.response)) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.waitForTimeout(4000)
      const real = await getNewBotResponses(countBefore)
      if (real.response && !LOADING_PAT.test(real.response)) { Object.assign(result, real); break }
    }
  }

  // FIX #1: disambiguation — auto-select the most relevant chip
  const DISAMBIG_PAT = [
    /please select the relation to move further/i,
    /select (a |the )?(product|relation|loan|card|account)/i,
    /which (loan|product|account|card|relation)/i,
    /you have multiple (product|relation|loan)/i,
    /please (choose|select|pick) (your |a )?(product|loan|card|relation|account)/i,
  ]
  const isDisambig = DISAMBIG_PAT.some(p => p.test(result.response))

  if (isDisambig && result.chips && result.chips.length > 0) {
    // Pick chip: prefer module-relevant match, else first chip
    const modKeyword = module.replace(/_Service$/, '').replace(/_/g, ' ').toLowerCase()
    const best = result.chips.find(c => c.toLowerCase().includes(modKeyword.split(' ')[0])) || result.chips[0]
    addLog(`  ↳ Disambiguation — auto-selecting: ${best}`)

    const chipCountBefore = await page.evaluate(() =>
      document.querySelectorAll('div.blu-bot-message').length
    ).catch(() => 0)

    await page.waitForTimeout(500)
    const chipClicked = await page.evaluate((text) => {
      let el = Array.from(document.querySelectorAll('button.overlap:not([disabled])')).find(b => b.innerText.trim() === text)
      if (!el) {
        const title = Array.from(document.querySelectorAll('.blu-relationshipcard__title')).find(b => b.innerText.trim() === text)
        if (title) {
          const arrow = title.closest('[class*="relationshipcard"]')?.querySelector('button,[role="button"],svg')
          el = arrow || title.closest('[class*="relationshipcard"]') || title.parentElement
        }
      }
      if (el) { el.click(); return true }
      return false
    }, best)

    if (chipClicked) {
      addLog(`  ↳ Chip click: ${best}`)
      await waitForBotToSettle(chipCountBefore)
      const chipResult = await getNewBotResponses(chipCountBefore)
      // FIX #3: check rate limit after chip click too
      if (/number of attempts exceeded|cannot proceed with your request/i.test(chipResult.response)) {
        addLog('🚫 Bot rate-limited after chip click — stopping run')
        stopRequested = true
      } else {
        Object.assign(result, chipResult)
      }
    } else {
      addLog(`  ↳ Chip click failed — element not found for: ${best}`)
    }
  }

  // Structural verdict
  const verdictObj = runVerdict({
    question, response: result.response, hasCTA: result.hasCTA,
    ctaLabels: result.ctaLabels, ctaLinks: result.ctaLinks,
    isHinglish: result.isHinglish, module, expectedBehaviour,
  })

  // FIX #2: LLM verdict with lower hybrid threshold — 70% sufficient to override REVIEW
  const llmResult = await Promise.race([
    runLLMVerdict({ question, expectedBehaviour, botResponse: result.response, module }),
    new Promise(r => setTimeout(() => r(null), 9000))
  ])

  if (llmResult) {
    // Lower threshold: 70% (was 80%) — reduces false REVIEWs on clear PASS responses
    const effectiveLLM = { ...llmResult }
    if (effectiveLLM.verdict === 'PASS' && effectiveLLM.confidence >= 70 && verdictObj.verdict === 'REVIEW') {
      verdictObj.verdict = 'PASS'
    } else {
      verdictObj.verdict = hybridVerdict(verdictObj, effectiveLLM)
    }
    verdictObj.verdictColor = verdictObj.verdict === 'PASS' ? '#22c55e' : verdictObj.verdict === 'FAIL' ? '#ef4444' : '#f59e0b'
    verdictObj.rules.push({ rule: 'LLM_VERDICT', status: llmResult.verdict, reason: `${llmResult.reason} (${llmResult.confidence}%)` })
  }

  const elapsed     = ((Date.now() - sendStart) / 1000).toFixed(1)
  const failedRules = verdictObj.rules.filter(r => r.status === 'FAIL' || r.status === 'REVIEW').map(r => r.rule)
  const icon        = verdictObj.verdict === 'PASS' ? '✅' : verdictObj.verdict === 'FAIL' ? '❌' : '⚠️'
  addLog(`  ${icon} ${verdictObj.verdict} (${elapsed}s)${failedRules.length ? ' — ' + failedRules.join(', ') : ''}`)

  // Screenshot on FAIL
  if (verdictObj.verdict === 'FAIL') {
    try {
      if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
      const buf   = await page.screenshot({ fullPage: false })
      const fname = `agent_fail_${tcId}_${Date.now()}.png`
      fs.writeFileSync(path.join(SCREENSHOTS_DIR, fname), buf)
    } catch {}
  }

  return makeResult({ tcId, module, l3, question, expectedBehaviour, result, verdict: verdictObj, failedRules })
}

function makeResult({ tcId, module, l3, question, expectedBehaviour, result = {}, verdict, failedRules = [] }) {
  return {
    tcId, module, l3, question, expectedBehaviour,
    response:      result.response || '',
    verdict:       verdict.verdict || 'REVIEW',
    verdictDetail: (verdict.rules || []).map(r => `${r.rule}: ${r.status}`).join(' | '),
    failedRules,
    ctaLabels:     result.ctaLabels || [],
    ctaLinks:      result.ctaLinks  || [],
    chatId:        currentChatId,
    testedAt:      new Date().toISOString(),
  }
}

// ── MAIN RUN LOOP ─────────────────────────────────────────────────────────────
async function runAgent(config) {
  const { env, mobile, modules, suite, casesPerModule } = config
  agentState.startedAt = new Date().toISOString()

  try {
    // Launch browser
    browser = await chromium.launch({ headless: false, slowMo: 60, args: ['--remote-debugging-port=9223'] })
    ctx     = await browser.newContext({ viewport: { width: 480, height: 820 } })
    page    = await ctx.newPage()

    page.on('load', async () => {
      try {
        await page.waitForTimeout(1500)
        await page.evaluate(() => {
          ['div.blu-bottom-glow','div.blu-bottom-wrapper','[class*="bottom"]','[class*="input"]'].forEach(sel => {
            const el = document.querySelector(sel)
            if (el) { el.style.overflow='visible';el.style.visibility='visible';el.style.opacity='1';el.style.zIndex='9999' }
          })
        }).catch(() => {})
      } catch {}
    })

    addLog('✅ Browser launched')

    // Check Ollama
    const ollamaOk = await isOllamaAvailable()
    addLog(ollamaOk ? '🧠 Ollama available — LLM verdict enabled' : '🧠 Ollama not running — structural verdict only')

    // Login
    await doLogin(env, mobile)

    // Wait for OTP if N2P
    if (agentState.status === 'awaiting_otp') {
      addLog('⏳ Waiting for OTP submission (max 3 min)...')
      await new Promise((resolve, reject) => {
        otpResolve = resolve
        setTimeout(() => reject(new Error('OTP timeout — 3 minutes elapsed')), 180000)
      })
      agentState.status = 'running'
    }

    // Load cases
    addLog(`📋 Loading cases for ${modules.length} module(s) from ${suite === 'realistic' ? 'realistic' : 'V7'} suite`)
    const cases = loadCases(suite, modules, casesPerModule)
    agentState.progress.total = cases.length
    addLog(`📊 ${cases.length} cases to run`)

    if (cases.length === 0) {
      agentState.status = 'done'
      addLog('⚠️ No cases found for selected modules')
      return
    }

    // Run
    for (const row of cases) {
      if (stopRequested) { addLog('🛑 Stop requested — halting run'); break }

      // 30-message re-auth guard
      if (msgCount >= 28) {
        addLog('🔄 Approaching session limit — re-auth now')
        await page.goto(BOT_URLS[env], { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(3000)
        msgCount = 0
        await reAuthIfNeeded()
      }

      agentState.progress.currentModule = row['Module'] || ''
      agentState.progress.currentCase   = row['Test Question'] || ''
      addLog(`▶ [${agentState.progress.done + 1}/${agentState.progress.total}] ${row['Module']} — ${(row['Test Question'] || '').substring(0, 60)}`)

      const result = await runCase(row)
      agentState.results.push(result)

      agentState.progress.done++
      if (result.verdict === 'PASS')        agentState.progress.pass++
      else if (result.verdict === 'FAIL')   agentState.progress.fail++
      else                                  agentState.progress.review++

      // FIX #3: stop run if rate limited
      if (stopRequested) {
        addLog('🚫 Rate limit detected — exporting results so far')
        break
      }

      await page.waitForTimeout(2500)
    }

    // Export bugs
    agentState.status = 'done'
    agentState.finishedAt = new Date().toISOString()
    const { done, total, pass, fail, review } = agentState.progress
    addLog(`\n📊 Run complete: ${done}/${total} tested | ✅ ${pass} PASS | ❌ ${fail} FAIL | ⚠️ ${review} REVIEW`)

    const exportedPath = await exportBugs(agentState.results, env)
    agentState.exportPath = exportedPath
    addLog(`📁 Bug report exported → ${exportedPath}`)

  } catch (e) {
    agentState.status = 'error'
    agentState.error  = e.message
    addLog('💥 Agent error: ' + e.message)
  } finally {
    if (browser) { await browser.close().catch(() => {}); browser = null }
  }
}

// ── EXPRESS SERVER ────────────────────────────────────────────────────────────
const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname)))  // serve agent_runner.html

// GET /modules — list available modules
app.get('/modules', (req, res) => {
  const suite = req.query.suite || 'v7'
  try {
    const mods = getAllModules(suite)
    res.json({ modules: mods })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /status — current agent state
app.get('/status', (req, res) => {
  res.json({
    status:      agentState.status,
    progress:    agentState.progress,
    log:         agentState.log.slice(-100),  // last 100 lines
    exportPath:  agentState.exportPath,
    error:       agentState.error,
    startedAt:   agentState.startedAt,
    finishedAt:  agentState.finishedAt,
  })
})

// POST /start — begin a run
app.post('/start', async (req, res) => {
  if (!['idle','done','stopped','error'].includes(agentState.status)) {
    return res.status(409).json({ error: 'Agent already running' })
  }
  const { env, mobile, modules, suite, casesPerModule } = req.body
  if (!env || !mobile || !modules || !modules.length) {
    return res.status(400).json({ error: 'env, mobile, and modules[] required' })
  }
  resetState()
  agentState.env            = env
  agentState.mobile         = mobile
  agentState.modules        = modules
  agentState.suite          = suite || 'v7'
  agentState.casesPerModule = casesPerModule || 'all'
  agentState.status         = 'starting'
  addLog(`🚀 Agent starting: ${env} | ${modules.length} modules | suite=${suite || 'v7'} | cap=${casesPerModule || 'all'}`)
  res.json({ ok: true })
  // Run async — don't await
  runAgent({ env, mobile, modules, suite: suite || 'v7', casesPerModule: casesPerModule || 'all' })
    .catch(e => { agentState.status = 'error'; agentState.error = e.message; addLog('💥 ' + e.message) })
})

// POST /otp — submit OTP (login or re-auth)
app.post('/otp', async (req, res) => {
  const { otp } = req.body
  if (!otp) return res.status(400).json({ error: 'otp required' })
  if (!['awaiting_otp','awaiting_reauth_otp'].includes(agentState.status)) {
    return res.status(409).json({ error: 'Not awaiting OTP' })
  }
  await submitOTPValue(otp)
  res.json({ ok: true })
})

// POST /stop — cancel run
app.post('/stop', (req, res) => {
  stopRequested = true
  agentState.status = 'stopped'
  addLog('🛑 Stop requested by user')
  res.json({ ok: true })
})

// Start
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true })

app.listen(PORT, () => {
  console.log(`🤖 BLU Agent Server running on http://localhost:${PORT}`)
  console.log(`   Open: http://localhost:${PORT}/agent_runner.html`)
  console.log(`   Dashboard (unchanged): open dashboard/blu_test_dashboard_v4.html\n`)
})
