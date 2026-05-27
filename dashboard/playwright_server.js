// BLU Playwright Bridge Server v3.0
// Phase 1 fixes:
//   - Retry card race condition: global lock + message queue
//   - Re-auth after auto-reset: detects mobile screen, re-logs silently
//   - Virtual scroll prep: bulk run respects queue ordering

const { chromium } = require('playwright')
const { WebSocketServer } = require('ws')
const fs   = require('fs')
const path = require('path')

const { runVerdict }                          = require('./verdict_engine')
const { runLLMVerdict, isOllamaAvailable, hybridVerdict } = require('./llm_verdict')

const PORT = 3001
let MOBILE = '9953333141'
let STORED_OTP = ''  // stored for re-auth after reset
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'automation', 'test-output', 'screenshots')
const LOG_PATH        = path.join(__dirname, '..', 'automation', 'test-output', 'session_log.json')
const RUN_STATE_PATH  = path.join(__dirname, '..', 'automation', 'test-output', '.run_state.json')

function writeRunState(state) {
  try { fs.writeFileSync(RUN_STATE_PATH, JSON.stringify(state, null, 2)) } catch {}
}
function readRunState() {
  try {
    if (fs.existsSync(RUN_STATE_PATH)) return JSON.parse(fs.readFileSync(RUN_STATE_PATH, 'utf-8'))
  } catch {}
  return null
}
function clearRunState() {
  try { if (fs.existsSync(RUN_STATE_PATH)) fs.unlinkSync(RUN_STATE_PATH) } catch {}
}

const BOT_URLS = {
  N2P:  'https://bflaiassist-n2p.bajajfinserv.in/blu/?jid=blu',
  UAT:  'https://bflaiassist-uat.bajajfinserv.in/blu/?jid=blu',
  PROD: '',
}

if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })

let browser, ctx, page, wss, activeWs
let sessionLog    = []
let currentChatId = null
let currentEnv    = 'N2P'
let msgCount      = 0
// UAT parity — second page for side-by-side comparison
let parityCtx  = null
let parityPage = null
let parityBusy = false
let pendingChipResolve = null  // resolves when user clicks a chip in dashboard

// ── CONCURRENCY CONTROL ────────────────────────────
// Single mutex — only one operation touches the bot at a time.
// Queued messages wait their turn instead of colliding.
let botLock    = false   // true = bot is busy (test running OR retry in progress)
let msgQueue   = []      // queued {msg, ws} pairs waiting for lock

function acquireLock() { botLock = true }
function releaseLock() {
  botLock = false
  drainQueue()
}
async function drainQueue() {
  if (botLock || msgQueue.length === 0) return
  const next = msgQueue.shift()
  await handleMessage(next.msg, next.ws)
}
function enqueue(msg, ws) {
  console.log(`⏸  Queued (bot busy): ${msg.type}${msg.id ? ' #'+msg.id : ''}`)
  if (activeWs) activeWs.send(JSON.stringify({ type: 'QUEUED', msgType: msg.type, id: msg.id }))
  msgQueue.push({ msg, ws })
}

// ── SESSION LOG ────────────────────────────────────
function logEntry(entry) {
  const ts  = new Date().toISOString()
  const row = { ts, ...entry }
  sessionLog.push(row)
  fs.writeFileSync(LOG_PATH, JSON.stringify(sessionLog, null, 2))
  if (activeWs) activeWs.send(JSON.stringify({ type: 'LOG_ENTRY', entry: row }))
}

// ── RETRY CARD HANDLER ─────────────────────────────
// acquires lock so no new messages fire during countdown wait
async function dismissRetryCard(maxWaitMs = 45000) {
  const start = Date.now()
  let retryDetected = false

  while (Date.now() - start < maxWaitMs) {
    const retryState = await page.evaluate(() => {
      const bodyText     = document.body.innerText || ''
      const hasRetryCard = /we.re facing a temporary issue/i.test(bodyText)
      if (!hasRetryCard) return { hasRetry: false }
      const retryBtns   = Array.from(document.querySelectorAll('button'))
        .filter(b => /^retry$/i.test(b.innerText.trim()))
      const activeBtn   = retryBtns.find(b => !b.disabled && b.offsetParent !== null)
      const countdownEl = document.querySelector('[class*="countdown"], [class*="remaining"]')
      const countdown   = countdownEl?.innerText?.trim() || ''
      return { hasRetry: true, canClick: !!activeBtn, countdown }
    }).catch(() => ({ hasRetry: false }))

    if (!retryState.hasRetry) {
      if (retryDetected) console.log('✅ Retry card dismissed')
      return true
    }

    retryDetected = true

    if (retryState.canClick) {
      console.log('🔄 Retry card — clicking Retry')
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => /^retry$/i.test(b.innerText.trim()) && !b.disabled && b.offsetParent !== null)
        if (btn) btn.click()
      })
      await page.waitForTimeout(2000)
      const stillThere = await page.evaluate(() =>
        /we.re facing a temporary issue/i.test(document.body.innerText || '')
      ).catch(() => false)
      if (!stillThere) { console.log('✅ Retry card dismissed'); return true }
    } else {
      if (retryState.countdown) {
        console.log(`⏳ Retry countdown: ${retryState.countdown} — holding queue`)
        if (activeWs) activeWs.send(JSON.stringify({
          type: 'RETRY_WAIT',
          countdown: retryState.countdown,
          queueLength: msgQueue.length
        }))
      }
      await page.waitForTimeout(3000)
    }
  }
  console.log('⚠️  Retry card did not dismiss — proceeding anyway')
  return false
}

// ── RE-AUTH DETECTION ──────────────────────────────
// Checks if bot has reset to mobile input screen (post-30-msg reset on N2P)
async function isBotOnLoginScreen() {
  return page.evaluate(() => {
    // Check for active mobile input field — not body text (which contains old bubbles)
    // The login screen shows a textarea that is empty and accepts mobile input
    // The post-login screen shows the chat interface with messages
    const textarea = document.querySelector('textarea')
    if (!textarea) return false

    // If we have bot messages, we're past login
    const botMsgs = document.querySelectorAll('div.blu-bot-message')
    if (botMsgs.length > 1) return false  // >1 message = active session

    // Check if the last bot message is specifically the mobile prompt
    const lastBotText = botMsgs[botMsgs.length - 1]?.innerText?.trim() || ''
    const isMobilePrompt = /please enter your mobile number/i.test(lastBotText)

    // Also check: textarea is empty and visible (login state)
    const textareaEmpty   = textarea.value.trim() === ''
    const textareaVisible = textarea.offsetParent !== null

    return isMobilePrompt && textareaEmpty && textareaVisible
  }).catch(() => false)
}

async function reAuthIfNeeded() {
  const onLogin = await isBotOnLoginScreen()
  if (!onLogin) return false

  console.log('🔑 Bot reset to login screen — re-authenticating')
  if (activeWs) activeWs.send(JSON.stringify({ type: 'REAUTH_START' }))

  // Re-send mobile
  await typeAndSend(MOBILE, true)
  await page.waitForTimeout(1000)

  if (currentEnv === 'UAT') {
    // UAT: use standard OTP directly
    await typeAndSend('123465', true)
  } else {
    // N2P: need real OTP — pause bulk run and ask dashboard
    if (activeWs) activeWs.send(JSON.stringify({ type: 'REAUTH_OTP_NEEDED', mobile: MOBILE }))
    // Wait up to 120s for OTP to be submitted via dashboard
    let waited = 0
    while (waited < 120000) {
      await page.waitForTimeout(2000)
      waited += 2000
      const stillOnLogin = await isBotOnLoginScreen()
      if (!stillOnLogin) break
    }
  }

  await page.waitForTimeout(2000)
  await captureChatId()
  msgCount = 0
  console.log('✅ Re-auth complete — resuming')
  if (activeWs) activeWs.send(JSON.stringify({ type: 'REAUTH_DONE' }))
  return true
}

// ── SCROLL TO COMPOSER ───────────────────────────────────────────────────────
async function scrollToComposer() {
  try {
    await page.evaluate(() => {
      const fixTargets = [
        '.blu-bottom-glow', '.blu-bottom-wrapper',
        '[class*="bottom"]', '[class*="input-wrap"]'
      ]
      fixTargets.forEach(sel => {
        const el = document.querySelector(sel)
        if (el) {
          el.style.overflow  = 'visible'
          el.style.visibility = 'visible'
          el.style.opacity   = '1'
          el.style.zIndex    = '9999'
        }
      })
      const ta = document.querySelector('textarea')
      if (ta) { ta.style.visibility = 'visible'; ta.style.opacity = '1'; ta.focus() }
    })
  } catch {}
}

// ── TEXTAREA HELPER ──────────────────────────────────────────────────────────
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

// ── SMART WAIT — ALL BUBBLES SETTLE ─────────────────────────────────────────
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
    const lastPart  = snapshot.split('|||').pop() || ''
    const loading   = ['hold on','please wait','checking','just a moment','fetching','kindly wait']
    if (loading.some(p => lastPart.toLowerCase().startsWith(p))) {
      stable = 0; prev = snapshot; continue
    }
    if (snapshot === prev && snapshot.length > 0) stable++
    else { stable = 0; prev = snapshot }
  }
  return true
}

// ── TYPE AND SEND ────────────────────────────────────────────────────────────
async function typeAndSend(text, waitForResponse = true) {
  try {
    // Only dismiss retry if not already inside a retry-dismiss cycle
    await dismissRetryCard()
    const sel         = await getVisibleTextarea()
    const countBefore = await page.evaluate(() =>
      document.querySelectorAll('div.blu-bot-message').length
    ).catch(() => 0)
    await page.click(sel)
    await page.waitForTimeout(150)
    await page.fill(sel, text)
    await page.waitForTimeout(150)
    await page.keyboard.press('Enter')
    msgCount++
    if (waitForResponse) await waitForBotToSettle(countBefore)
    return true
  } catch (e) {
    console.log('⚠️  typeAndSend failed:', e.message)
    return false
  }
}

// ── CAPTURE CHAT ID ──────────────────────────────────────────────────────────
async function captureChatId() {
  try {
    const bluHeader = await page.$('.blu-header-title, .blu-header-wrapper, h1, .blu-header-title h1')
    if (bluHeader) {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await bluHeader.click()
      await page.waitForTimeout(1000)
      const clipText = await page.evaluate(async () => {
        try { return await navigator.clipboard.readText() } catch { return null }
      })
      if (clipText) {
        try {
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
          if (clipText.length > 5 && clipText.length < 50 && !clipText.includes(' ')) {
            currentChatId = clipText.trim()
            if (activeWs) activeWs.send(JSON.stringify({ type: 'CHAT_ID', chatId: currentChatId }))
            return currentChatId
          }
        }
      }
    }
  } catch (e) { console.log('⚠️  Chat ID capture error:', e.message) }
  return currentChatId
}

// ── GET ALL NEW BOT RESPONSES ────────────────────────────────────────────────
async function getNewBotResponses(countBefore) {
  const start   = Date.now()
  const LOADING = ['hold on','please wait','checking','just a moment','fetching','kindly wait']
  let loadWait  = 0
  while (loadWait < 20000) {
    const lastText = await page.evaluate(() => {
      const msgs = document.querySelectorAll('div.blu-bot-message')
      return msgs[msgs.length-1]?.innerText?.trim().toLowerCase() || ''
    }).catch(() => '')
    if (!LOADING.some(p => lastText.startsWith(p))) break
    await page.waitForTimeout(1500)
    loadWait += 1500
  }
  try {
    const result = await page.evaluate((before) => {
      const allBotMsgs = Array.from(document.querySelectorAll('div.blu-bot-message'))
      const newBubbles = allBotMsgs.slice(before)
      if (!newBubbles.length) newBubbles.push(allBotMsgs[allBotMsgs.length - 1])
      const texts = newBubbles.flatMap(bubble => {
        const ps = Array.from(bubble.querySelectorAll('p.blu-text-message-text'))
          .map(p => p.innerText.trim()).filter(Boolean)
        return ps.length ? ps : [bubble.innerText.trim()]
      }).filter(Boolean)
      const text = texts.join('\n\n')
      const quickChips = Array.from(document.querySelectorAll('button.overlap:not([disabled])')).filter(el=>el.offsetParent!==null).map(el=>el.innerText.trim()).filter(Boolean)
      const relCards   = Array.from(document.querySelectorAll('.blu-relationshipcard__title')).filter(el=>el.offsetParent!==null).map(el=>el.innerText.trim()).filter(Boolean)
      const chips = [...new Set([...quickChips,...relCards])].slice(0,10)
      const ctaEls = newBubbles.flatMap(b =>
        Array.from(b.querySelectorAll('a, button[class*="cta"], div[class*="cta"], [onclick*="bajaj"], [href]'))
      )
      // Capture both label and deep link / href for each CTA
      const ctaItems = ctaEls.map(el => {
        const label   = el.innerText.trim()
        const href    = el.getAttribute('href') || ''
        const onclick = el.getAttribute('onclick') || ''
        // Extract bajajsuperapp:// deep link from href or onclick
        const deepMatch = (href + ' ' + onclick).match(/bajajsuperapp:\/\/[^\s"')]+/)
        const link = deepMatch ? deepMatch[0] : (href && href !== '#' ? href : '')
        return label ? { label, link } : null
      }).filter(Boolean)
      const ctaLabels = ctaItems.map(c => c.label)
      const ctaLinks  = ctaItems.map(c => c.link)
      return { text, bubbleCount: newBubbles.length, chips, hasCTA: ctaLabels.length > 0, ctaLabels, ctaLinks }
    }, countBefore)

    const elapsed    = ((Date.now() - start) / 1000).toFixed(1)
    const isHinglish = detectHinglish(result.text)
    if (result.bubbleCount > 1) console.log(`🤖 ${result.bubbleCount} bubbles (${elapsed}s): ${result.text.substring(0,100)}`)
    else console.log(`🤖 Response (${elapsed}s): ${result.text.substring(0,100)}`)
    if (result.chips.length) console.log(`  💬 Chips: ${result.chips.join(' | ')}`)
    if (result.hasCTA) {
      const ctaDisplay = result.ctaLabels.map((l,i) => result.ctaLinks?.[i] ? `${l} → ${result.ctaLinks[i]}` : l).join(' | ')
      console.log(`  🔗 CTAs: ${ctaDisplay}`)
    }
    if (isHinglish)          console.log(`  🌐 Hinglish detected`)
    return { response: result.text || '(response not captured)', bubbleCount: result.bubbleCount,
             chips: result.chips, hasCTA: result.hasCTA, ctaLabels: result.ctaLabels,
             elapsed, isHinglish, chatId: currentChatId }
  } catch (e) { console.log('⚠️  Response capture error:', e.message) }
  return { response: '(response not captured)', bubbleCount: 0, chips: [], hasCTA: false,
           ctaLabels: [], ctaLinks: [], elapsed: '?', isHinglish: false, chatId: null }
}

// ── HINGLISH DETECTION ───────────────────────────────────────────────────────
function detectHinglish(text) {
  const words = ['karo','karna','chahiye','hai','hain','nahi','nhin','aap','mera','meri',
    'muje','apna','apni','bata','dena','lena','milega','hoga','karega','karein','kijiye',
    'dijiye','batao','dekho','suno','theek','bilkul','zaroor','krna','pata','kaise','kitna']
  const lower = text.toLowerCase()
  return words.filter(w => lower.includes(w)).length >= 2
}

// ── SCREENSHOT ───────────────────────────────────────────────────────────────
async function takeScreenshot(label) {
  const ts    = new Date().toISOString().replace(/[:.]/g, '-')
  const fname = `${label}_${ts}.png`
  const fpath = path.join(SCREENSHOTS_DIR, fname)
  try {
    const buf = await page.screenshot({ fullPage: false })
    fs.writeFileSync(fpath, buf)
    console.log(`📸 Screenshot: ${fname}`)
    return { path: fpath, name: fname, b64: buf.toString('base64') }
  } catch (e) { console.log('⚠️  Screenshot failed:', e.message); return null }
}

// ── LOGIN ────────────────────────────────────────────────────────────────────
async function startLogin(env, url, mobile) {
  if (mobile) MOBILE = mobile.replace(/\D/g, '')
  currentEnv = env
  const botUrl = url || BOT_URLS[env]
  if (!botUrl) { console.log('⚠️  No URL for', env); return }
  console.log('🌐 Navigating to', botUrl)
  await page.goto(botUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  await scrollToComposer()
  await page.waitForTimeout(500)
  console.log('📱 Sending mobile:', MOBILE)
  await typeAndSend(MOBILE, true)
  console.log('📲 Mobile sent — requesting OTP')
  if (activeWs) activeWs.send(JSON.stringify({ type: 'REQUEST_OTP', mobile: MOBILE }))
}

async function submitOTP(otp) {
  STORED_OTP = otp  // store for re-auth
  console.log('🔑 Sending OTP:', otp)
  await typeAndSend(otp, true)
  await page.waitForTimeout(2000)
  await captureChatId()
  console.log('✅ Login complete')
  if (activeWs) activeWs.send(JSON.stringify({ type: 'LOGIN_OK', sessionRestored: false }))
  logEntry({ type: 'LOGIN', env: currentEnv, mobile: MOBILE })
  startMessageObserver()
}

// ── SEND MESSAGE ─────────────────────────────────────────────────────────────
async function sendMessage(question, caseId = null, expectedBehaviour = '', module = '') {
  console.log('💬 Sending:', question.substring(0, 70))

  // Check for re-auth need before every message
  await reAuthIfNeeded()

  const countBefore = await page.evaluate(() =>
    document.querySelectorAll('div.blu-bot-message').length
  ).catch(() => 0)

  const ok = await typeAndSend(question, true)
  if (!ok) {
    const emptyVerdict = runVerdict({ question, response: '', module, expectedBehaviour })
    return { response: '(could not send)', chips: [], hasCTA: false, ctaLabels: [],
             elapsed: '?', isHinglish: false, verdict: emptyVerdict, chatId: null }
  }

  const result  = await getNewBotResponses(countBefore)

  // Multi-turn: detect disambiguation, wait up to 60s for chip selection
  const DISAMBIG_PAT = [
    /please select the relation to move further/i,
    /select (a |the )?(product|relation|loan|card|account)/i,
    /which (loan|product|account|card|relation)/i,
    /you have multiple (product|relation|loan)/i,
    /please (choose|select|pick) (your |a )?(product|loan|card|relation|account)/i,
  ]
  const isDisambig = DISAMBIG_PAT.some(p => p.test(result.response))

  if (isDisambig && caseId && result.chips.length > 0) {
    console.log('Multi-turn disambig for case ' + caseId + ' — awaiting chip (60s)')
    if (activeWs) activeWs.send(JSON.stringify({
      type: 'AWAIT_CHIP', caseId, chips: result.chips,
      originalQuestion: question, module, expectedBehaviour, timeout: 60000,
    }))
    const selectedChip = await new Promise(resolve => {
      pendingChipResolve = resolve
      setTimeout(() => {
        if (pendingChipResolve) { pendingChipResolve(null); pendingChipResolve = null }
      }, 60000)
    })
    if (selectedChip) {
      console.log('User selected chip: ' + selectedChip)
      const chipCountBefore = await page.evaluate(() =>
        document.querySelectorAll('div.blu-bot-message').length
      ).catch(() => 0)
      // Wait for relation cards to be fully rendered before clicking
      await page.waitForTimeout(500)
      const chipClicked = await page.evaluate((text) => {
        // Try quick reply button first
        let el = Array.from(document.querySelectorAll('button.overlap:not([disabled])')).find(b=>b.innerText.trim()===text)
        if (!el) {
          // Try relation card title — walk up to find clickable parent
          const titles = Array.from(document.querySelectorAll('.blu-relationshipcard__title'))
          const title  = titles.find(b=>b.innerText.trim()===text)
          if (title) {
            // Click the arrow/chevron button inside the card if present
            const arrow = title.closest('[class*="relationshipcard"]')?.querySelector('button, [role="button"], svg')
            el = arrow || title.closest('[class*="relationshipcard"]') || title.parentElement
          }
        }
        if (el) { el.click(); return true }
        return false
      }, selectedChip)
      console.log(`  ↳ Chip click result: ${chipClicked ? 'clicked' : 'element not found'}`)
      await waitForBotToSettle(chipCountBefore)
      const chipResult = await getNewBotResponses(chipCountBefore)
      result.response    = chipResult.response
      result.chips       = chipResult.chips
      result.hasCTA      = chipResult.hasCTA
      result.ctaLabels   = chipResult.ctaLabels
      result.ctaLinks    = chipResult.ctaLinks
      result.isHinglish  = chipResult.isHinglish
      result.bubbleCount = chipResult.bubbleCount
      result.elapsed     = chipResult.elapsed
      result.multiTurnChip = selectedChip
      console.log('Multi-turn final: ' + result.response.substring(0, 80))
      if (activeWs) activeWs.send(JSON.stringify({ type: 'CHIP_RESOLVED', caseId, chip: selectedChip }))
    } else {
      console.log('No chip selected in 60s — marking REVIEW')
      if (activeWs) activeWs.send(JSON.stringify({ type: 'CHIP_TIMEOUT', caseId }))
    }
  }

  const verdict = runVerdict({
    question, response: result.response, chips: result.chips,
    hasCTA: result.hasCTA, ctaLabels: result.ctaLabels, ctaLinks: result.ctaLinks,
    isHinglish: result.isHinglish, module, expectedBehaviour,
  })

  // ── LLM VERDICT (Ollama Llama 3.1 8B) ────────────
  // Runs in parallel — never blocks test run
  const llmResult = await Promise.race([
    runLLMVerdict({ question, expectedBehaviour, botResponse: result.response, module }),
    new Promise(resolve => setTimeout(() => resolve(null), 9000))  // 9s hard timeout
  ])

  if (llmResult) {
    const hybrid = hybridVerdict(verdict, llmResult)
    const icon   = hybrid === 'PASS' ? '✅' : hybrid === 'FAIL' ? '❌' : '⚠️'
    console.log(`🧠 LLM: ${icon} ${llmResult.verdict} (${llmResult.confidence}%) — ${llmResult.reason}`)
    if (hybrid !== verdict.verdict) {
      console.log(`   ↳ Hybrid override: keyword=${verdict.verdict} → LLM=${llmResult.verdict} → final=${hybrid}`)
    }
    // Attach LLM result to verdict object
    verdict.llm     = llmResult
    verdict.verdict = hybrid
    verdict.verdictColor = hybrid === 'PASS' ? '#22c55e' : hybrid === 'FAIL' ? '#ef4444' : '#f59e0b'
    // Add LLM as a rule row in the verdict breakdown
    verdict.rules.push({
      rule:       'LLM_VERDICT',
      status:     llmResult.verdict,
      reason:     `${llmResult.reason} (${llmResult.confidence}% confidence, ${llmResult.elapsed}s)`,
      confidence: llmResult.confidence,
    })
  } else {
    console.log('🧠 LLM: unavailable — keyword verdict used')
  }

  result.verdict   = verdict
  result.autoScore = { score: verdict.verdict, confidence: verdict.confidence,
                       reasons: verdict.rules.map(r => r.reason) }

  // Screenshot on hard FAIL only
  let screenshot = null
  if (verdict.verdict === 'FAIL') {
    screenshot = await takeScreenshot(caseId ? `fail_case_${caseId}` : 'fail_direct')
  }
  result.screenshot = screenshot ? { name: screenshot.name, b64: screenshot.b64 } : null

  logEntry({
    type: 'TEST', caseId, module, question,
    response: result.response, elapsed: result.elapsed,
    verdict: verdict.verdict, verdictRules: verdict.rules,
    hasCTA: result.hasCTA, isHinglish: result.isHinglish,
    chatId: currentChatId, chips: result.chips
  })

  // Auto-reset check
  msgCount++
  if (msgCount >= 30) {
    console.log('🔄 Auto-reset: 30 messages reached — re-auth will trigger on next message')
    await page.goto(BOT_URLS[currentEnv] || '', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    msgCount = 0
    if (activeWs) activeWs.send(JSON.stringify({ type: 'SESSION_RESET' }))
    // Re-auth immediately so next message doesn't fail
    await reAuthIfNeeded()
  }

  return result
}

// ── CLICK CHIP ───────────────────────────────────────────────────────────────
async function clickChip(chipText, caseId = null) {
  try {
    const countBefore = await page.evaluate(() =>
      document.querySelectorAll('div.blu-bot-message').length
    ).catch(() => 0)
    const clicked = await page.evaluate((text) => {
      let el = Array.from(document.querySelectorAll('button.overlap:not([disabled])')).find(b=>b.innerText.trim()===text)
      if (!el) {
        const t = Array.from(document.querySelectorAll('.blu-relationshipcard__title')).find(b=>b.innerText.trim()===text)
        el = t?.closest('.blu-relationshipcard') || t?.parentElement || t
      }
      if (el) { el.click(); return true }
      return false
    }, chipText)
    if (clicked) {
      console.log(`🖱️  Clicked chip: ${chipText}`)
      await waitForBotToSettle(countBefore)
      const result = await getNewBotResponses(countBefore)
      logEntry({ type: 'CHIP_CLICK', caseId, chip: chipText, response: result.response, chatId: currentChatId })
      return result
    }
  } catch (e) { console.log('⚠️  Chip click failed:', e.message) }
  return null
}

// ── PASSIVE MESSAGE OBSERVER ─────────────────────────────────────────────────
// Only fires when bot lock is NOT held — avoids racing with active test runs
let observerActive = false

async function startMessageObserver() {
  if (observerActive) return
  observerActive = true
  let lastCount = 0
  let lastText  = ''
  console.log('👁️  Message observer started')

  const interval = setInterval(async () => {
    if (!page || !activeWs || botLock) return  // respect lock
    try {
      const result = await page.evaluate(() => {
        const msgs     = Array.from(document.querySelectorAll('div.blu-bot-message'))
        const last     = msgs[msgs.length - 1]
        const texts    = Array.from(last?.querySelectorAll('p.blu-text-message-text') || [])
          .map(p => p.innerText.trim()).filter(Boolean)
        const text     = texts.join('\n') || last?.innerText?.trim() || ''
        const userMsgs = Array.from(document.querySelectorAll('div.blu-user-message'))
        const lastUser = userMsgs[userMsgs.length - 1]?.innerText?.trim() || ''
        const chips    = Array.from(document.querySelectorAll('button.overlap:not([disabled])'))
          .filter(el => el.offsetParent !== null).map(el => el.innerText.trim()).filter(Boolean).slice(0,8)
        return { count: msgs.length, text, lastUser, chips }
      }).catch(() => ({ count: lastCount, text: lastText, lastUser: '', chips: [] }))

      if (result.count > lastCount && result.text !== lastText && result.text.length > 5) {
        const loading = ['hold on','please wait','checking','just a moment','fetching','kindly wait']
        if (!loading.some(p => result.text.toLowerCase().startsWith(p))) {
          if (result.lastUser) console.log(`👆 User selected: ${result.lastUser}`)
          console.log(`👁️  Observer (${result.count}): ${result.text.substring(0,80)}`)
          lastText  = result.text
          lastCount = result.count
          activeWs.send(JSON.stringify({
            type: 'PASSIVE_RESPONSE', response: result.text,
            userAction: result.lastUser, chips: result.chips, elapsed: '—'
          }))
          logEntry({ type: 'passive', question: result.lastUser||'(chip/action)', response: result.text })
        }
      } else if (result.count > lastCount) {
        lastCount = result.count
      }
    } catch {}
  }, 1500)

  page.once('close', () => { clearInterval(interval); observerActive = false })
}

// ── CENTRAL MESSAGE HANDLER ──────────────────────────────────────────────────
// All incoming WS messages go through here.
// Lock-requiring operations acquire the lock; others run freely.
async function handleMessage(msg, ws) {
  const lockRequired = ['RUN_CASE','DIRECT_SEND','CLICK_CHIP','BULK_RUN']  // CHIP_SELECTED handled outside lock

  if (lockRequired.includes(msg.type)) {
    if (botLock) { enqueue(msg, ws); return }
    acquireLock()
    try {
      if (msg.type === 'RUN_CASE') {
        const result = await sendMessage(msg.question, msg.id, msg.expectedBehaviour || '', msg.module || '')
        ws.send(JSON.stringify({ type: 'RESPONSE', id: msg.id, ...result }))
      }
      else if (msg.type === 'DIRECT_SEND') {
        const result = await sendMessage(msg.question, null, '', msg.module || '')
        ws.send(JSON.stringify({ type: 'DIRECT_RESPONSE', ...result, ts: msg.ts }))
      }
      else if (msg.type === 'CLICK_CHIP') {
        const result = await clickChip(msg.chip, msg.caseId || null)
        ws.send(JSON.stringify({ type: 'CHIP_RESPONSE', chip: msg.chip, caseId: msg.caseId, ...result }))
      }
      else if (msg.type === 'BULK_RUN') {
        const cases  = msg.cases || []
        const delay  = msg.delay || 3000
        const total  = cases.length
        let   done   = 0
        for (const c of cases) {
          if (!botLock) break  // stopped via END_SESSION
          const result = await sendMessage(c.question, c.id, c.expectedBehaviour || '', c.module || '')
          ws.send(JSON.stringify({ type: 'RESPONSE', id: c.id, ...result }))
          done++
          // Persist run state after every case
          writeRunState({
            lastTcId:    c.id,
            done,
            total,
            module:      c.module || '',
            env:         currentEnv,
            ts:          new Date().toISOString(),
          })
          // Brief release between cases — lets queued single messages sneak in
          releaseLock()
          await page.waitForTimeout(delay)
          acquireLock()
        }
        ws.send(JSON.stringify({ type: 'BULK_RUN_DONE', count: done }))
        // Clear run state on clean completion
        if (done === total) clearRunState()
      }
      else if (msg.type === 'GET_RUN_STATE') {
        const state = readRunState()
        ws.send(JSON.stringify({ type: 'RUN_STATE', state }))
      }
    } finally {
      releaseLock()
    }
    return
  }

  // Non-lock operations
  if (msg.type === 'START_LOGIN') {
    await startLogin(msg.env, msg.url, msg.mobile)
  }
  else if (msg.type === 'SUBMIT_OTP') {
    await submitOTP(msg.otp)
  }
  else if (msg.type === 'SCREENSHOT') {
    const shot = await takeScreenshot(msg.label || 'manual')
    ws.send(JSON.stringify({ type: 'SCREENSHOT_DONE', ...shot }))
  }
  else if (msg.type === 'GET_CHAT_ID') {
    await captureChatId()
  }
  else if (msg.type === 'END_SESSION') {
    msgQueue = []  // clear queue on session end
    if (page) await page.goto('about:blank').catch(() => {})
    msgCount = 0
    botLock  = false
    console.log('🔒 Session ended — queue cleared')
  }
  else if (msg.type === 'CLEAR_RUN_STATE') {
    clearRunState()
    console.log('🗑️  Run state cleared')
  }
  else if (msg.type === 'CHIP_SELECTED') {
    if (pendingChipResolve) {
      console.log('🖱️  Chip selected by user: ' + msg.chip)
      const resolve = pendingChipResolve
      pendingChipResolve = null  // clear immediately — prevents duplicate fires
      resolve(msg.chip)
    }
    // Silently ignore duplicates — no log spam
  }
  else if (msg.type === 'PARITY_CHECK') {
    if (parityBusy) {
      ws.send(JSON.stringify({ type: 'PARITY_RESULT', id: msg.id, error: 'Parity check already in progress' }))
      return
    }
    parityBusy = true
    try {
      // Launch UAT page if not already open
      const uatUrl = BOT_URLS['UAT']
      if (!parityCtx) {
        parityCtx  = await browser.newContext({ viewport: { width: 480, height: 820 } })
        parityPage = await parityCtx.newPage()
      }
      console.log(`🔄 Parity check: ${msg.question.substring(0,50)}`)
      // Login to UAT (uses standard OTP 123465)
      await parityPage.goto(uatUrl, { waitUntil: 'domcontentloaded' })
      await parityPage.waitForTimeout(3000)
      // Send mobile
      await parityPage.waitForSelector('textarea', { timeout: 10000 }).catch(()=>{})
      await parityPage.fill('textarea', msg.mobile || '9953333141')
      await parityPage.keyboard.press('Enter')
      await parityPage.waitForTimeout(3000)
      // Send UAT OTP
      await parityPage.fill('textarea', '123465')
      await parityPage.keyboard.press('Enter')
      await parityPage.waitForTimeout(3000)
      // Send the question
      const countBefore = await parityPage.evaluate(() =>
        document.querySelectorAll('div.blu-bot-message').length
      ).catch(() => 0)
      await parityPage.fill('textarea', msg.question)
      await parityPage.keyboard.press('Enter')
      // Wait for response
      let waited = 0
      while (waited < 20000) {
        await parityPage.waitForTimeout(1000)
        waited += 1000
        const count = await parityPage.evaluate(() =>
          document.querySelectorAll('div.blu-bot-message').length
        ).catch(() => 0)
        if (count > countBefore) break
      }
      await parityPage.waitForTimeout(2000)
      // Get response
      const uatResponse = await parityPage.evaluate(() => {
        const msgs = Array.from(document.querySelectorAll('div.blu-bot-message'))
        const last = msgs[msgs.length - 1]
        return last?.innerText?.trim() || '(no response)'
      }).catch(() => '(capture failed)')
      // Score UAT response
      const uatVerdict = runVerdict({
        question: msg.question, response: uatResponse,
        module: msg.module || '', expectedBehaviour: msg.expectedBehaviour || '',
      })
      console.log(`  N2P: ${msg.n2pVerdict} | UAT: ${uatVerdict.verdict}`)
      ws.send(JSON.stringify({
        type:        'PARITY_RESULT',
        id:          msg.id,
        uatResponse,
        uatVerdict:  uatVerdict.verdict,
        uatRules:    uatVerdict.rules,
        n2pVerdict:  msg.n2pVerdict,
        match:       msg.n2pVerdict === uatVerdict.verdict,
      }))
      // Navigate away to reset UAT session
      await parityPage.goto('about:blank').catch(() => {})
    } catch (e) {
      console.log('⚠️  Parity check error:', e.message)
      ws.send(JSON.stringify({ type: 'PARITY_RESULT', id: msg.id, error: e.message }))
    } finally {
      parityBusy = false
    }
  }
  // Re-auth OTP submitted from dashboard during N2P re-auth wait
  else if (msg.type === 'REAUTH_OTP') {
    STORED_OTP = msg.otp
    await typeAndSend(msg.otp, true)
    await page.waitForTimeout(2000)
    await captureChatId()
    msgCount = 0
    console.log('✅ Re-auth OTP submitted')
    ws.send(JSON.stringify({ type: 'REAUTH_DONE' }))
  }
}

// ── START SERVER ─────────────────────────────────────────────────────────────
async function startServer() {
  browser = await chromium.launch({
    headless: false,
    args: ['--remote-debugging-port=9222'],
    slowMo: 60
  })
  ctx  = await browser.newContext({ viewport: { width: 480, height: 820 } })
  page = await ctx.newPage()

  page.on('load', async () => {
    try {
      await page.waitForTimeout(1500)
      await page.evaluate(() => {
        const fixedEls = [
          document.querySelector('.blu-bottom-glow'),
          document.querySelector('.blu-bottom-wrapper'),
          document.querySelector('[class*="bottom"]'),
          document.querySelector('[class*="input"]'),
        ]
        fixedEls.forEach(el => {
          if (!el) return
          el.style.overflow   = 'visible'
          el.style.visibility = 'visible'
          el.style.opacity    = '1'
          el.style.zIndex     = '9999'
        })
      }).catch(() => {})
      await page.setViewportSize({ width: 480, height: 820 })
    } catch {}
  })

  console.log('✅ Browser launched')

  // Check Ollama on startup
  isOllamaAvailable().then(ok => {
    if (ok) console.log('🧠 Ollama available — LLM verdict enabled (llama3.1-local)')
    else    console.log('🧠 Ollama not running — keyword verdict only (run: ollama serve)')
  })

  wss = new WebSocketServer({ port: PORT })
  console.log(`🚀 Bridge running on ws://localhost:${PORT}`)
  console.log(`📋 Dashboard: open blu_test_dashboard_v4.html\n`)

  wss.on('connection', ws => {
    activeWs   = ws
    sessionLog = []
    msgQueue   = []
    botLock    = false
    console.log('🔌 Dashboard connected')

    ws.on('message', async raw => {
      let msg
      try { msg = JSON.parse(raw) } catch { return }
      console.log('📨', msg.type, msg.env || '', msg.id ? `#${msg.id}` : '')
      await handleMessage(msg, ws)
    })

    ws.on('close', () => {
      console.log('🔌 Dashboard disconnected')
      botLock  = false
      msgQueue = []
    })
    ws.on('error', () => {})
  })
}

startServer().catch(err => { console.error('Fatal:', err); process.exit(1) })
