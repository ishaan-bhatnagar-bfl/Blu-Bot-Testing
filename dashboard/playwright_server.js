// BLU Playwright Bridge Server v2
// Features: session persistence, smart wait, multi-turn, CTA detection,
//           Hinglish detection, Chat ID capture, screenshot on failure,
//           response timing, chip capture, auto-score, KB update trigger

const { chromium } = require('playwright')
const { WebSocketServer } = require('ws')
const fs = require('fs')
const path = require('path')

const PORT = 3001
let MOBILE = '9953333141' // overridden per session
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'automation', 'test-output', 'screenshots')
const LOG_PATH = path.join(__dirname, '..', 'automation', 'test-output', 'session_log.json')

const BOT_URLS = {
  N2P:  'https://bflaiassist-n2p.bajajfinserv.in/blu/?jid=blu',
  UAT:  'https://bflaiassist-uat.bajajfinserv.in/blu/?jid=blu',
  PROD: '',
}

// Ensure dirs exist
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })

let browser, ctx, page, wss, activeWs
let sessionLog = []
let currentChatId = null
let currentEnv = 'N2P'
let msgCount = 0

// ── SESSION LOG ────────────────────────────────────
function logEntry(entry) {
  const ts = new Date().toISOString()
  const row = { ts, ...entry }
  sessionLog.push(row)
  fs.writeFileSync(LOG_PATH, JSON.stringify(sessionLog, null, 2))
  if (activeWs) activeWs.send(JSON.stringify({ type: 'LOG_ENTRY', entry: row }))
}

// ── TEXTAREA HELPER ────────────────────────────────
async function getVisibleTextarea() {
  await page.waitForSelector('textarea:visible', { timeout: 10000 })
  return 'textarea:visible'
}

// ── SMART WAIT FOR BOT RESPONSE ────────────────────
async function waitForNewBotMessage(countBefore, maxMs = 25000) {
  const start = Date.now()
  // Phase 1: wait for new message to appear (poll every 800ms)
  while (Date.now() - start < maxMs) {
    await page.waitForTimeout(800)
    const countNow = await page.evaluate(() =>
      document.querySelectorAll('div.blu-bot-message').length
    ).catch(() => 0)
    if (countNow > countBefore) {
      // Phase 2: wait for bot to finish — text + relation cards + chips all stabilise
      let prev = '', stable = 0
      while (stable < 4 && Date.now() - start < maxMs) {
        await page.waitForTimeout(1000)
        const curr = await page.evaluate(() => {
          const msgs = document.querySelectorAll('div.blu-bot-message')
          const lastBot = msgs[msgs.length - 1]
          // Include inner text + any relation cards/chips visible
          return lastBot?.innerText?.trim() || ''
        }).catch(() => '')
        if (curr === prev && curr.length > 0) stable++
        else { stable = 0; prev = curr }
      }
      return true
    }
  }
  return false
}

// ── TYPE AND SEND ──────────────────────────────────
async function typeAndSend(text, waitForResponse = true) {
  try {
    const sel = await getVisibleTextarea()
    const countBefore = await page.evaluate(() =>
      document.querySelectorAll('div.blu-bot-message').length
    ).catch(() => 0)
    await page.click(sel)
    await page.fill(sel, text)
    await page.keyboard.press('Enter')
    msgCount++
    if (waitForResponse) await waitForNewBotMessage(countBefore)
    return true
  } catch (e) {
    console.log('⚠️  typeAndSend failed:', e.message)
    return false
  }
}

// ── CAPTURE CHAT ID ────────────────────────────────
async function captureChatId() {
  try {
    // Click the Blu header icon — it auto-copies chat ID JSON to clipboard
    const bluHeader = await page.$('.blu-header-title, .blu-header-wrapper, h1, .blu-header-title h1')
    if (bluHeader) {
      // Grant clipboard permissions
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await bluHeader.click()
      await page.waitForTimeout(1000)
      // Read clipboard
      const clipText = await page.evaluate(async () => {
        try { return await navigator.clipboard.readText() } catch { return null }
      })
      if (clipText) {
        try {
          // Chat ID is JSON: {"chatId":"...","chatTransactionId":"...","mobileNumber":"..."}
          const parsed = JSON.parse(clipText)
          if (parsed.chatId) {
            currentChatId = parsed.chatId
            const fullInfo = `${parsed.chatId} | txn:${parsed.chatTransactionId || ''}`
            console.log(`🆔 Chat ID: ${fullInfo}`)
            if (activeWs) activeWs.send(JSON.stringify({ type: 'CHAT_ID', chatId: currentChatId, chatInfo: parsed }))
            logEntry({ type: 'CHAT_ID', chatId: currentChatId, chatInfo: parsed })
            return currentChatId
          }
        } catch {
          // Not JSON — might be plain ID
          if (clipText.length > 5 && clipText.length < 50 && !clipText.includes(' ')) {
            currentChatId = clipText.trim()
            console.log(`🆔 Chat ID (plain): ${currentChatId}`)
            if (activeWs) activeWs.send(JSON.stringify({ type: 'CHAT_ID', chatId: currentChatId }))
            return currentChatId
          }
        }
      }
    }
    console.log('ℹ️  Chat ID not captured — click Blu icon manually if needed')
  } catch (e) {
    console.log('⚠️  Chat ID capture error:', e.message)
  }
  return currentChatId
}

// ── GET LAST BOT RESPONSE ──────────────────────────
async function getLastBotResponse() {
  const start = Date.now()
  // Wait for "Hold on..." / loading states to resolve (max 15s extra)
  const LOADING_PHRASES = ['hold on', 'please wait', 'checking', 'just a moment', 'fetching']
  let loadWait = 0
  while (loadWait < 15000) {
    const lastText = await page.evaluate(() => {
      const msgs = document.querySelectorAll('div.blu-bot-message')
      return msgs[msgs.length-1]?.innerText?.trim().toLowerCase() || ''
    }).catch(() => '')
    if (!LOADING_PHRASES.some(p => lastText.startsWith(p))) break
    await page.waitForTimeout(1500)
    loadWait += 1500
  }
  if (loadWait > 0) console.log(`⏳ Waited ${loadWait}ms for loading to resolve`)

  try {
    const result = await page.evaluate(() => {
      const botMsgs = Array.from(document.querySelectorAll('div.blu-bot-message'))
      if (!botMsgs.length) return { text: '', chips: [], hasCTA: false, ctaLabels: [] }
      const lastBot = botMsgs[botMsgs.length - 1]

      // Text — collect ALL paragraphs from last message
      const texts = Array.from(lastBot.querySelectorAll('p.blu-text-message-text'))
        .map(p => p.innerText.trim()).filter(Boolean)
      const text = texts.join('\n') || lastBot.innerText.trim()

      // Chips / quick reply buttons (visible, not disabled)
      const chipEls = Array.from(document.querySelectorAll(
        'button.overlap:not([disabled]), div[class*="chip"] button, div[class*="quick"] button'
      )).filter(el => el.offsetParent !== null)
      const chips = chipEls.map(el => el.innerText.trim()).filter(Boolean).slice(0, 10)

      // CTA detection
      const ctaEls = Array.from(lastBot.querySelectorAll('a, button[class*="cta"], div[class*="cta"]'))
      const ctaLabels = ctaEls.map(el => el.innerText.trim()).filter(Boolean)
      const hasCTA = ctaLabels.length > 0

      return { text, chips, hasCTA, ctaLabels }
    })

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    const isHinglish = detectHinglish(result.text)

    console.log(`🤖 Response (${elapsed}s): ${result.text.substring(0, 100)}`)
    if (result.chips.length) console.log(`  💬 Chips: ${result.chips.join(' | ')}`)
    if (result.hasCTA) console.log(`  🔗 CTAs: ${result.ctaLabels.join(' | ')}`)
    if (isHinglish) console.log(`  🌐 Hinglish detected in response`)

    return {
      response: result.text || '(response not captured)',
      chips: result.chips,
      hasCTA: result.hasCTA,
      ctaLabels: result.ctaLabels,
      elapsed,
      isHinglish,
      chatId: currentChatId
    }
  } catch (e) {
    console.log('⚠️  Response capture error:', e.message)
  }
  return { response: '(response not captured)', chips: [], hasCTA: false, ctaLabels: [], elapsed: '?', isHinglish: false, chatId: null }
}

// ── HINGLISH DETECTION ─────────────────────────────
function detectHinglish(text) {
  const hinglishWords = ['karo','karna','chahiye','hai','hain','nahi','aap','mera','meri','muje','apna','apni','bata','dena','lena','milega','hoga','karega','karein','kijiye','dijiye','batao','dekho','suno','theek','bilkul','zaroor']
  const lower = text.toLowerCase()
  return hinglishWords.filter(w => lower.includes(w)).length >= 2
}

// ── AUTO SCORE ─────────────────────────────────────
function autoScore(botResponse, expectedBehaviour, question) {
  if (!botResponse || !expectedBehaviour) return { score: 'Manual Review', confidence: 0, reasons: [] }

  const resp = botResponse.toLowerCase()
  const expected = expectedBehaviour.toLowerCase()
  const reasons = []
  let score = 0

  // Extract key phrases from expected (skip HTML-stripped artifacts)
  const keywords = expected
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !['should','would','could','provide','accurate','information','with','that','this','from','will','have','been','your','their'].includes(w))
    .slice(0, 8)

  const matched = keywords.filter(k => resp.includes(k))
  const matchRate = keywords.length > 0 ? matched.length / keywords.length : 0

  if (matchRate >= 0.5) { score += 40; reasons.push(`${matched.length}/${keywords.length} keywords matched`) }
  else { reasons.push(`Only ${matched.length}/${keywords.length} keywords matched`) }

  // Length check — fallback responses are short
  if (botResponse.length > 80) { score += 20; reasons.push('Response has substance') }
  else reasons.push('Response too short')

  // Negative signals
  const fallbacks = ['i am an ai', 'cannot help', 'please contact', 'i don\'t have', 'hold on', 'just a moment']
  if (fallbacks.some(f => resp.includes(f))) { score -= 20; reasons.push('Fallback/escalation response') }

  const result = score >= 40 ? 'Auto: Pass' : score >= 20 ? 'Auto: Review' : 'Auto: Fail'
  return { score: result, confidence: Math.min(100, Math.max(0, score + 40)), reasons }
}

// ── SCREENSHOT ─────────────────────────────────────
async function takeScreenshot(label) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const fname = `${label}_${ts}.png`
  const fpath = path.join(SCREENSHOTS_DIR, fname)
  try {
    const buf = await page.screenshot({ fullPage: false })
    fs.writeFileSync(fpath, buf)
    console.log(`📸 Screenshot: ${fname}`)
    // Convert to base64 for dashboard embedding
    const b64 = buf.toString('base64')
    return { path: fpath, name: fname, b64 }
  } catch (e) {
    console.log('⚠️  Screenshot failed:', e.message)
    return null
  }
}

// ── LOGIN ──────────────────────────────────────────
async function startLogin(env, url, mobile) {
  if (mobile) MOBILE = mobile.replace(/\D/g, '')
  currentEnv = env
  const botUrl = url || BOT_URLS[env]
  if (!botUrl) { console.log('⚠️  No URL for', env); return }

  console.log('🌐 Navigating to', botUrl)
  await page.goto(botUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  console.log('📱 Sending mobile:', MOBILE)
  await typeAndSend(MOBILE, true)
  console.log('📲 Mobile sent — requesting OTP')
  if (activeWs) activeWs.send(JSON.stringify({ type: 'REQUEST_OTP', mobile: MOBILE }))
}

async function submitOTP(otp) {
  console.log('🔑 Sending OTP:', otp)
  await typeAndSend(otp, true)
  await page.waitForTimeout(2000)

  await captureChatId()
  console.log('✅ Login complete')
  if (activeWs) activeWs.send(JSON.stringify({ type: 'LOGIN_OK', sessionRestored: false }))
  logEntry({ type: 'LOGIN', env: currentEnv, mobile: MOBILE })
  // Start passive observer — captures any bot message including chip-triggered responses
  startMessageObserver()
}

// ── SEND MESSAGE ───────────────────────────────────
async function sendMessage(question, caseId = null, expectedBehaviour = '') {
  console.log('💬 Sending:', question.substring(0, 70))
  const ok = await typeAndSend(question, true)
  if (!ok) return { response: '(could not send)', chips: [], hasCTA: false, ctaLabels: [], elapsed: '?', isHinglish: false, autoScore: { score: 'Manual Review', confidence: 0, reasons: [] }, chatId: null }

  const result = await getLastBotResponse()

  // Auto score
  const scoring = autoScore(result.response, expectedBehaviour, question)
  result.autoScore = scoring

  // Screenshot on auto-fail
  let screenshot = null
  if (scoring.score === 'Auto: Fail') {
    const label = caseId ? `fail_case_${caseId}` : 'fail_direct'
    screenshot = await takeScreenshot(label)
  }
  result.screenshot = screenshot ? { name: screenshot.name, b64: screenshot.b64 } : null

  // Log entry
  logEntry({
    type: 'TEST',
    caseId,
    question,
    response: result.response,
    elapsed: result.elapsed,
    autoScore: scoring.score,
    hasCTA: result.hasCTA,
    isHinglish: result.isHinglish,
    chatId: currentChatId,
    chips: result.chips
  })

  // Auto-reset after 30 messages to avoid context contamination
  msgCount++
  if (msgCount >= 30) {
    console.log('🔄 Auto-reset: 30 messages reached')
    await page.goto(BOT_URLS[currentEnv] || '', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    msgCount = 0
    if (activeWs) activeWs.send(JSON.stringify({ type: 'SESSION_RESET' }))
  }

  return result
}

// ── CLICK CHIP ─────────────────────────────────────
async function clickChip(chipText) {
  try {
    const countBefore = await page.evaluate(() =>
      document.querySelectorAll('div.blu-bot-message').length
    ).catch(() => 0)
    const clicked = await page.evaluate((text) => {
      const btns = Array.from(document.querySelectorAll('button.overlap:not([disabled])'))
      const btn = btns.find(b => b.innerText.trim() === text)
      if (btn) { btn.click(); return true }
      return false
    }, chipText)
    if (clicked) {
      console.log(`🖱️  Clicked chip: ${chipText}`)
      await waitForNewBotMessage(countBefore)
      const result = await getLastBotResponse()
      logEntry({ type: 'CHIP_CLICK', chip: chipText, response: result.response, chatId: currentChatId })
      return result
    }
  } catch (e) { console.log('⚠️  Chip click failed:', e.message) }
  return null
}

// ── PASSIVE MESSAGE OBSERVER ──────────────────────
// Watches for new bot messages even when user clicks chips manually
let observerActive = false
async function startMessageObserver() {
  if (observerActive) return
  observerActive = true
  let lastCount = 0
  let lastText = ''
  console.log('👁️  Message observer started')
  const interval = setInterval(async () => {
    if (!page || !activeWs) return
    try {
      const result = await page.evaluate(() => {
        const msgs = Array.from(document.querySelectorAll('div.blu-bot-message'))
        const last = msgs[msgs.length - 1]
        const texts = Array.from(last?.querySelectorAll('p.blu-text-message-text') || [])
          .map(p => p.innerText.trim()).filter(Boolean)
        const text = texts.join('\n') || last?.innerText?.trim() || ''
        // Also capture any user messages (chip clicks show as user bubbles)
        const userMsgs = Array.from(document.querySelectorAll('div.blu-user-message'))
        const lastUser = userMsgs[userMsgs.length - 1]?.innerText?.trim() || ''
        const chips = Array.from(document.querySelectorAll(
          'button.overlap:not([disabled])'
        )).filter(el => el.offsetParent !== null).map(el => el.innerText.trim()).filter(Boolean).slice(0,8)
        return { count: msgs.length, text, lastUser, chips }
      }).catch(() => ({ count: lastCount, text: lastText, lastUser: '', chips: [] }))

      // New bot message appeared (from chip click or any user action)
      if (result.count > lastCount && result.text !== lastText && result.text.length > 5) {
        // Skip loading phrases
        const loading = ['hold on','please wait','checking','just a moment','fetching']
        if (!loading.some(p => result.text.toLowerCase().startsWith(p))) {
          if (result.lastUser) console.log(`👆 User selected: ${result.lastUser}`)
          console.log(`👁️  Observer captured (${result.count}): ${result.text.substring(0,80)}`)
          lastText = result.text
          lastCount = result.count
          // Send to dashboard as passive response
          activeWs.send(JSON.stringify({
            type: 'PASSIVE_RESPONSE',
            response: result.text,
            userAction: result.lastUser,
            chips: result.chips,
            elapsed: '—'
          }))
          logEntry({ type: 'test', question: result.lastUser||'(chip click)', response: result.text })
        }
      } else if (result.count > lastCount) {
        lastCount = result.count
      }
    } catch {}
  }, 1500)

  // Stop observer on session end
  page.once('close', () => { clearInterval(interval); observerActive = false })
}

// ── START SERVER ───────────────────────────────────
async function startServer() {
  browser = await chromium.launch({ headless: false, args: ['--remote-debugging-port=9222'], slowMo: 60 })
  ctx = await browser.newContext({ viewport: { width: 480, height: 900 } })
  page = await ctx.newPage()
  console.log('✅ Browser launched')

  wss = new WebSocketServer({ port: PORT })
  console.log(`🚀 Bridge running on ws://localhost:${PORT}`)
  console.log(`📋 Dashboard: open blu_test_dashboard_v2.html\n`)

  wss.on('connection', ws => {
    activeWs = ws
    sessionLog = []
    console.log('🔌 Dashboard connected')

    ws.on('message', async raw => {
      let msg
      try { msg = JSON.parse(raw) } catch { return }
      console.log('📨', msg.type, msg.env || '', msg.id ? `#${msg.id}` : '')

      if (msg.type === 'START_LOGIN') {
        await startLogin(msg.env, msg.url, msg.mobile)
      }
      else if (msg.type === 'SUBMIT_OTP') {
        await submitOTP(msg.otp)
      }
      else if (msg.type === 'RUN_CASE') {
        const result = await sendMessage(msg.question, msg.id, msg.expectedBehaviour || '')
        ws.send(JSON.stringify({ type: 'RESPONSE', id: msg.id, ...result }))
      }
      else if (msg.type === 'DIRECT_SEND') {
        const result = await sendMessage(msg.question, null, '')
        ws.send(JSON.stringify({ type: 'DIRECT_RESPONSE', ...result, ts: msg.ts }))
      }
      else if (msg.type === 'CLICK_CHIP') {
        const result = await clickChip(msg.chip)
        ws.send(JSON.stringify({ type: 'CHIP_RESPONSE', chip: msg.chip, ...result }))
      }
      else if (msg.type === 'SCREENSHOT') {
        const shot = await takeScreenshot(msg.label || 'manual')
        ws.send(JSON.stringify({ type: 'SCREENSHOT_DONE', ...shot }))
      }
      else if (msg.type === 'GET_CHAT_ID') {
        await captureChatId()
      }
      else if (msg.type === 'BULK_RUN') {
        // Run array of cases with delay
        const cases = msg.cases || []
        const delay = msg.delay || 3000
        for (const c of cases) {
          const result = await sendMessage(c.question, c.id, c.expectedBehaviour || '')
          ws.send(JSON.stringify({ type: 'RESPONSE', id: c.id, ...result }))
          await page.waitForTimeout(delay)
        }
        ws.send(JSON.stringify({ type: 'BULK_RUN_DONE', count: cases.length }))
      }
      else if (msg.type === 'END_SESSION') {
        if (page) await page.goto('about:blank').catch(() => {})
        msgCount = 0
        console.log('🔒 Session ended')
      }
    })

    ws.on('close', () => console.log('🔌 Dashboard disconnected'))
    ws.on('error', () => {})
  })
}

startServer().catch(err => { console.error('Fatal:', err); process.exit(1) })
