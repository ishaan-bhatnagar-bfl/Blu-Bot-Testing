/**
 * BLU Bot — LLM Verdict Module
 * Uses local Ollama (Mistral 7B) for per-response semantic scoring.
 * Falls back silently to null if Ollama is not running.
 *
 * Usage:
 *   const { runLLMVerdict, isOllamaAvailable } = require('./llm_verdict')
 *   const llm = await runLLMVerdict({ question, expectedBehaviour, botResponse, module })
 *   // llm = { verdict, reason, confidence, model, elapsed } | null
 */

const http = require('http')

const OLLAMA_HOST    = 'localhost'
const OLLAMA_PORT    = 11434
const OLLAMA_MODEL   = 'llama3.1-local'
const TIMEOUT_MS     = 10000   // 10s max — never block test run
const MAX_RESP_CHARS = 600     // truncate long responses before sending to LLM

// ── AVAILABILITY CHECK ────────────────────────────────────────────────────────
let _ollamaAvailable = null   // cached after first check
let _lastCheck       = 0

async function isOllamaAvailable() {
  // Re-check every 60s in case Ollama starts/stops mid-run
  if (Date.now() - _lastCheck < 60000 && _ollamaAvailable !== null) {
    return _ollamaAvailable
  }
  return new Promise(resolve => {
    const req = http.get(
      { host: OLLAMA_HOST, port: OLLAMA_PORT, path: '/api/tags', timeout: 2000 },
      res => {
        _ollamaAvailable = res.statusCode === 200
        _lastCheck = Date.now()
        resolve(_ollamaAvailable)
        res.resume()
      }
    )
    req.on('error', () => {
      _ollamaAvailable = false
      _lastCheck = Date.now()
      resolve(false)
    })
    req.on('timeout', () => {
      req.destroy()
      _ollamaAvailable = false
      _lastCheck = Date.now()
      resolve(false)
    })
  })
}

// ── PROMPT BUILDER ────────────────────────────────────────────────────────────
function buildPrompt(question, expectedBehaviour, botResponse, module) {
  // Truncate long KB answers to avoid prompt bloat
  const truncated = s => (s || '').substring(0, MAX_RESP_CHARS)
    .replace(/CTA Label:.*$/gm, '[CTA]')   // strip CTA label lines
    .replace(/Click here.*$/gm, '[LINK]')  // strip link text
    .trim()

  const mod = module ? `\nModule: ${module}` : ''

  return {
    system: `You are a QA evaluator for BLU Bot, an AI customer service assistant for Bajaj Finance (an Indian NBFC). Your job is to evaluate whether the bot's response correctly addresses the customer's question based on the expected answer from the knowledge base.

Rules:
- PASS: Bot response addresses the question with correct information, even if phrasing differs. A response that answers correctly AND asks a follow-up clarifying question is still a PASS.
- FAIL: Bot response is wrong, is a fallback/loading error ("Working on it...", "Hold on..."), gives irrelevant product info, or completely misses the question
- REVIEW: Bot response is partially correct, ambiguous, or you are not confident

Important: If the bot correctly answers the question but also asks a follow-up (e.g. "Are you looking to buy online or offline?"), that is PASS, not FAIL.

Respond ONLY with valid JSON. No preamble. No explanation outside the JSON.
Format: {"verdict":"PASS","reason":"one sentence max 15 words","confidence":85}`,

    user: `Question: ${question}${mod}

Expected Answer (KB):
${truncated(expectedBehaviour)}

Actual Bot Response:
${truncated(botResponse)}

Evaluate and respond with JSON only.`
  }
}

// ── OLLAMA API CALL ───────────────────────────────────────────────────────────
function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:  OLLAMA_MODEL,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user',   content: prompt.user   },
      ],
      stream: false,
      options: {
        temperature:  0.1,   // low temp = consistent verdicts
        num_predict:  120,    // enough for JSON verdict
        top_p:        0.9,
      }
    })

    const req = http.request(
      {
        host:   OLLAMA_HOST,
        port:   OLLAMA_PORT,
        path:   '/api/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: TIMEOUT_MS,
      },
      res => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            // /api/chat returns message.content; /api/generate returns response
            resolve(parsed.message?.content || parsed.response || '')
          } catch {
            reject(new Error('Ollama response parse failed'))
          }
        })
      }
    )

    req.on('error',   reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Ollama timeout')) })
    req.write(body)
    req.end()
  })
}

// ── PARSE LLM RESPONSE ────────────────────────────────────────────────────────
function parseLLMResponse(raw) {
  if (!raw) return null

  // Extract JSON from response (model sometimes adds extra text)
  const jsonMatch = raw.match(/\{[^}]+\}/)
  if (!jsonMatch) return null

  try {
    const parsed = JSON.parse(jsonMatch[0])

    // Normalise verdict
    const v = (parsed.verdict || '').toUpperCase().trim()
    const verdict = ['PASS','FAIL','REVIEW'].includes(v) ? v : 'REVIEW'

    // Confidence: 0-100 integer
    const confidence = Math.min(100, Math.max(0, parseInt(parsed.confidence) || 70))

    // Reason: strip quotes, trim
    const reason = (parsed.reason || '').replace(/^["']|["']$/g, '').trim().substring(0, 120)

    return { verdict, reason, confidence }
  } catch {
    return null
  }
}

// ── HYBRID VERDICT ────────────────────────────────────────────────────────────
// Combines keyword verdict (fast) with LLM verdict (semantic).
// LLM overrides keyword when they disagree — LLM is more accurate.
function hybridVerdict(keywordVerdict, llmResult) {
  if (!llmResult) return keywordVerdict.verdict  // LLM failed — use keyword

  const kw  = keywordVerdict.verdict
  const llm = llmResult.verdict

  if (kw === 'SOURCING_SKIP') return 'SOURCING_SKIP'  // always respected
  if (kw === llm) return kw                             // agreement
  if (llm === 'FAIL') return 'FAIL'                     // LLM says fail → fail
  if (llm === 'PASS' && kw === 'FAIL') return 'REVIEW'  // disagreement → review
  return 'REVIEW'                                        // any other disagreement
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────
async function runLLMVerdict({ question, expectedBehaviour, botResponse, module }) {
  const start = Date.now()

  // Skip if no expected behaviour to evaluate against
  if (!expectedBehaviour || !botResponse) return null

  // Skip sourcing queries
  const SOURCING = /apply|apply karna|loan lena|naya loan|insta emi|application form/i
  if (SOURCING.test(question)) return { verdict: 'SOURCING_SKIP', reason: 'Sourcing intent', confidence: 100 }

  // Detect disambiguation responses — bot is asking user to select a product/relation
  // These are valid mid-flow states, not failures. Mark REVIEW, don't call LLM.
  const DISAMBIGUATION = [
    /please select the relation to move further/i,
    /select (a |the )?(product|relation|loan|card|account)/i,
    /which (loan|product|account|card|relation)/i,
    /you have multiple (product|relation|loan)/i,
    /please (choose|select|pick) (your |a )?(product|loan|card|relation|account)/i,
    /select (your )?(loan|emi card|fd|deposit|card) to (proceed|continue|move)/i,
    /please let (me|us) know which/i,
  ]
  const isDisambiguation = DISAMBIGUATION.some(p => p.test(botResponse))
  if (isDisambiguation) {
    return {
      verdict:    'REVIEW',
      reason:     'Disambiguation step — bot awaiting product selection, re-run after selecting',
      confidence: 100,
      model:      'rule-based',
      elapsed:    '0.0',
    }
  }

  // Note: follow-up questions in bot responses are handled by the LLM system prompt

  // Check Ollama availability
  const available = await isOllamaAvailable()
  if (!available) {
    // Silent fail — don't log every time, just return null
    return null
  }

  try {
    const prompt  = buildPrompt(question, expectedBehaviour, botResponse, module)
    const rawResp = await callOllama(prompt)
    const parsed  = parseLLMResponse(rawResp)
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)

    if (!parsed) return null

    return {
      verdict:    parsed.verdict,
      reason:     parsed.reason,
      confidence: parsed.confidence,
      model:      OLLAMA_MODEL,
      elapsed,
      raw:        rawResp.substring(0, 200)  // for debug
    }
  } catch (e) {
    // Timeout or error — silent fail, keyword verdict stands
    if (process.env.DEBUG_LLM) console.log(`🧠 LLM error: ${e.message}`)
    return null
  }
}

module.exports = { runLLMVerdict, isOllamaAvailable, hybridVerdict, parseLLMResponse }
