/**
 * BLU Bot — Formal Verdict Engine v1.0
 * 
 * Runs structured Pass/Fail rules on top of auto-score keyword matching.
 * Each rule returns: { rule, status, reason }
 * Final verdict: PASS | FAIL | REVIEW | SOURCING_SKIP
 * 
 * Usage (Node.js):
 *   const { runVerdict } = require('./verdict_engine')
 *   const verdict = runVerdict({ question, response, chips, hasCTA, ctaLabels,
 *                                 isHinglish, module, expectedBehaviour, keyPhrases })
 * 
 * Usage (browser — include as <script>):
 *   const verdict = BLUVerdict.runVerdict({ ... })
 */

// ── MODULE MIN LENGTH MAP ──────────────────────────────────────────────────────
// Minimum character length for a substantive bot response per module.
// Short responses on complex modules = likely fallback or incomplete answer.
const MODULE_MIN_LENGTH = {
  'Flexi_Loan_PL_Service':       120,
  'Flexi_Loan_SME_Service':      120,
  'Flexi_Wheels_Service':        100,
  'LAFD_Service':                100,
  'EMI_Card_Service':            80,
  'Health_EMI_Card_Service':     80,
  'FD_SDP_Service':              80,
  'Help_Support':                60,
  'Term_Loan_PL_Service':        120,
  'Term_Loan_PB_Service':        120,
  'Home_Loan_Service':           100,
  'Gold_Loan_Service':           80,
  'Insurance_Service':           80,
  'Payments_UPI_Service':        60,
  'Payments_BBPS_Service':       60,
  'Payments_Wallets_Service':    60,
  'Fastag_Service':              60,
  'Profile_Service':             60,
  'Rewards_Service':             60,
  'Generic_Loan_Service':        60,
  'Generic_Cards_Service':       60,
  'Generic_Deposits_Service':    60,
  'LAS_Service':                 80,
  'DEFAULT':                     60,
}

// ── FALLBACK PATTERNS ─────────────────────────────────────────────────────────
const FALLBACK_PATTERNS = [
  /we.re facing a temporary issue/i,
  /please click on retry/i,
  /i('m| am) (sorry|unable|not able)/i,
  /i (can't|cannot|don't) (help|assist|answer|understand)/i,
  /i don.t have (information|access|details) (on|about|for)/i,
  /please (contact|reach out to|visit|call) (our|the|a|bajaj|branch|customer)/i,
  /please try again/i,
  /something went wrong/i,
  /i.m not sure (about|how|what)/i,
  /that.s (outside|beyond) (my|what i)/i,
  /i (only|just) (handle|assist with|help with)/i,
  /not available (right now|at the moment|currently)/i,
]

// ── ESCALATION PATTERNS (separate from fallback) ──────────────────────────────
const ESCALATION_PATTERNS = [
  /raise a request/i,
  /raisedrequest/i,
  /contact (our |the )?(support|team|agent|helpdesk)/i,
  /speak (to|with) (an? )?(agent|representative|executive)/i,
  /connect(ing)? you to/i,
  /transfer(ring)? (your|this) (call|chat)/i,
]

// ── SOURCING / APPLY INTENT PATTERNS ─────────────────────────────────────────
const SOURCING_PATTERNS = [
  /apply (for|karna|krna)/i,
  /loan (lena|leni|chahiye|apply)/i,
  /new (loan|card|fd|account)/i,
  /open (an?|a new) (account|fd|deposit)/i,
  /(get|take|avail) (a |an )?(loan|card|credit)/i,
  /loan (apply|application|form)/i,
  /how (do i|can i|to) (apply|get|take)/i,
  /apply karna tha/i,
  /loan lena/i,
  /naya loan/i,
  /new (emi card|insta emi|health card)/i,
]

// ── CROSS-PRODUCT CONTAMINATION MAP ──────────────────────────────────────────
// For a given module, these terms in the response signal contamination.
const CROSS_PRODUCT_MAP = {
  'EMI_Card_Service':         [/home loan/i, /gold loan/i, /two wheeler/i, /car finance/i, /fixed deposit/i, /sdp/i],
  'Health_EMI_Card_Service':  [/home loan/i, /gold loan/i, /fixed deposit/i, /emi network card(?! health)/i],
  'FD_SDP_Service':           [/personal loan/i, /home loan/i, /emi card/i, /two wheeler/i],
  'LAFD_Service':             [/home loan/i, /gold loan/i, /emi card/i, /two wheeler/i, /sdp/i],
  'Flexi_Wheels_Service':     [/fixed deposit/i, /emi card/i, /personal flexi loan(?! for)/i, /insurance/i],
  'Flexi_Loan_PL_Service':    [/two wheeler/i, /car finance/i, /tractor/i, /gold loan/i, /fixed deposit/i, /emi card/i],
  'Flexi_Loan_SME_Service':   [/two wheeler/i, /car finance/i, /gold loan/i, /fixed deposit/i, /emi card/i],
  'Help_Support':             [], // Help & Support can reference any product
}

// ── HINGLISH DETECTION ────────────────────────────────────────────────────────
const HINGLISH_WORDS = ['karo','karna','chahiye','hai','hain','nahi','nhin','aap','mera','meri',
  'muje','apna','apni','bata','dena','lena','milega','hoga','karega','karein','kijiye',
  'dijiye','batao','dekho','suno','theek','bilkul','zaroor','krna','krein','dijiye',
  'lijiye','batayein','samajh','samjhe','pata','kyun','kya','kaise','kitna','kitne']

function isHinglishText(text) {
  const lower = text.toLowerCase()
  return HINGLISH_WORDS.filter(w => lower.includes(w)).length >= 2
}

// ── RULE RUNNERS ──────────────────────────────────────────────────────────────

function ruleLanguage({ response, question, isHinglish }) {
  const ruleName = 'LANGUAGE'
  const queryIsHinglish = isHinglish || isHinglishText(question || '')
  const responseIsHinglish = isHinglishText(response || '')

  if (queryIsHinglish) {
    // Hinglish query → Hinglish response is acceptable
    return { rule: ruleName, status: 'PASS', reason: 'Hinglish query — Hinglish response acceptable' }
  }
  if (responseIsHinglish) {
    return {
      rule: ruleName,
      status: 'FAIL',
      reason: 'English query received Hinglish response — language mismatch'
    }
  }
  return { rule: ruleName, status: 'PASS', reason: 'Response in English as expected' }
}

function ruleNoFallback({ response, expectedBehaviour }) {
  const ruleName = 'NO_FALLBACK'
  const text = response || ''
  // FIX #4: if KB expects escalation, /please contact.../ patterns are valid — skip fallback check
  const kbExpectsEscalation = /raise a request|raisedrequest|contact (support|team|agent)/i.test(expectedBehaviour || '')
  if (kbExpectsEscalation) {
    return { rule: ruleName, status: 'PASS', reason: 'Escalation expected by KB — fallback check skipped' }
  }
  const matched = FALLBACK_PATTERNS.find(p => p.test(text))
  if (matched) {
    return {
      rule: ruleName,
      status: 'FAIL',
      reason: `Fallback response detected: "${text.substring(0, 80)}..."`
    }
  }
  if (/we.re facing a temporary issue/i.test(text) || /please click on retry/i.test(text)) {
    return { rule: ruleName, status: 'FAIL', reason: 'Retry/error card shown instead of answer' }
  }
  return { rule: ruleName, status: 'PASS', reason: 'No fallback pattern detected' }
}

function ruleCTA({ hasCTA, ctaLabels, expectedBehaviour, module }) {
  const ruleName = 'CTA_PRESENT'
  const expected = (expectedBehaviour || '').toLowerCase()

  // Check if KB explicitly mentions a CTA
  const kbExpectsCTA = /cta label|cta link|bajajsuperapp:\/\/|raise a request|document cent(er|re)|click here|tap here/i.test(expectedBehaviour || '')

  if (!kbExpectsCTA) {
    return { rule: ruleName, status: 'PASS', reason: 'CTA not expected for this query' }
  }
  if (hasCTA) {
    return {
      rule: ruleName,
      status: 'PASS',
      reason: `CTA present: ${(ctaLabels || []).join(', ') || '(detected)'}`
    }
  }
  return {
    rule: ruleName,
    status: 'FAIL',
    reason: 'KB expects CTA but none detected in bot response'
  }
}

function ruleNoCrossProduct({ response, module }) {
  const ruleName = 'NO_CROSS_PRODUCT'
  const patterns = CROSS_PRODUCT_MAP[module] || []
  if (patterns.length === 0) {
    return { rule: ruleName, status: 'PASS', reason: 'Cross-product check not applicable for this module' }
  }
  const text = response || ''
  const contaminated = patterns.filter(p => p.test(text))
  if (contaminated.length > 0) {
    const examples = contaminated.map(p => p.toString().replace(/\//g, '').replace(/i$/, '')).join(', ')
    return {
      rule: ruleName,
      status: 'FAIL',
      reason: `Cross-product contamination: response mentions [${examples}] for module ${module}`
    }
  }
  return { rule: ruleName, status: 'PASS', reason: 'No cross-product contamination detected' }
}

function ruleMinLength({ response, module, expectedBehaviour }) {
  const ruleName = 'MIN_LENGTH'
  const minLen = MODULE_MIN_LENGTH[module] || MODULE_MIN_LENGTH['DEFAULT']
  const len = (response || '').length
  if (len < minLen) {
    // FIX #2: if KB answer itself is short (CTA redirect or brief answer), don't penalise short bot response
    const kbLen = (expectedBehaviour || '').replace(/CTA label:.*$/gim, '').replace(/bajajsuperapp:.*$/gim, '').trim().length
    if (kbLen < minLen) {
      return { rule: ruleName, status: 'PASS', reason: `KB answer is also short (${kbLen} chars) — short response acceptable` }
    }
    return {
      rule: ruleName,
      status: 'REVIEW',  // FIX #2: REVIEW not FAIL — hybrid logic should decide, not MIN_LENGTH alone
      reason: `Response short: ${len} chars (min ${minLen} for ${module || 'this module'}) — LLM to confirm`
    }
  }
  return { rule: ruleName, status: 'PASS', reason: `Response length ${len} chars ≥ min ${minLen}` }
}

function ruleSourcingGuard({ question }) {
  const ruleName = 'SOURCING_GUARD'
  const q = question || ''
  const matched = SOURCING_PATTERNS.find(p => p.test(q))
  if (matched) {
    return {
      rule: ruleName,
      status: 'SKIP',
      reason: `Sourcing/apply intent detected in query — out of scope for Service testing`
    }
  }
  return { rule: ruleName, status: 'PASS', reason: 'Query is Service intent — in scope' }
}

function ruleEscalationCorrectness({ response, expectedBehaviour }) {
  const ruleName = 'ESCALATION_CHECK'
  const expected = (expectedBehaviour || '').toLowerCase()
  const text = response || ''
  const kbExpectsEscalation = /raise a request|raisedrequest|contact (support|team|agent)/i.test(expected)
  const botEscalated = ESCALATION_PATTERNS.some(p => p.test(text))

  if (kbExpectsEscalation && !botEscalated) {
    return {
      rule: ruleName,
      status: 'REVIEW',
      reason: 'KB expects escalation/raise-request CTA but bot did not escalate'
    }
  }
  if (!kbExpectsEscalation && botEscalated) {
    return {
      rule: ruleName,
      status: 'REVIEW',
      reason: 'Bot escalated to agent/raise-request but KB answer suggests direct resolution possible'
    }
  }
  return { rule: ruleName, status: 'PASS', reason: 'Escalation behaviour matches KB expectation' }
}

// ── KEYWORD SCORE (existing auto-score, kept as a rule) ───────────────────────
function ruleKeywordMatch({ response, expectedBehaviour, question }) {
  const ruleName = 'KEYWORD_MATCH'
  if (!response || !expectedBehaviour) {
    return { rule: ruleName, status: 'REVIEW', reason: 'No expected behaviour to match against', confidence: 0 }
  }

  // Short Hinglish queries (<5 meaningful tokens) — semantic scoring unreliable
  // Return REVIEW so LLM makes the call
  const qTokens = (question||'').toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/).filter(w=>w.length>2)
  if (qTokens.length < 5) {
    return { rule: ruleName, status: 'REVIEW', reason: `Short query (${qTokens.length} tokens) — LLM verdict preferred`, confidence: 50 }
  }

  // Use semantic TF-IDF scoring if available, fall back to keyword overlap
  try {
    const { semanticScore } = require('./semantic_scorer')
    const result = semanticScore(expectedBehaviour, response)
    return {
      rule:       ruleName,
      status:     result.verdict,
      reason:     result.reason,
      confidence: result.confidence,
    }
  } catch {
    // Fallback: keyword overlap (semantic_scorer not available)
    const resp     = response.toLowerCase()
    const expected = expectedBehaviour.toLowerCase()
    const keywords = expected
      .replace(/<[^>]+>/g, ' ').replace(/[^\w\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 4 && !['should','would','could','provide','accurate',
        'information','please','bajaj','finserv','click','label','https'].includes(w))
      .slice(0, 10)
    if (!keywords.length) return { rule: ruleName, status: 'REVIEW', reason: 'No scoreable keywords', confidence: 50 }
    const matched    = keywords.filter(k => resp.includes(k))
    const confidence = Math.round((matched.length / keywords.length) * 100)
    const status     = confidence >= 50 ? 'PASS' : confidence >= 25 ? 'REVIEW' : 'FAIL'
    return { rule: ruleName, status, reason: `${matched.length}/${keywords.length} keywords matched (${confidence}%) [fallback]`, confidence }
  }
}

// ── MAIN VERDICT RUNNER ───────────────────────────────────────────────────────
function runVerdict(input) {
  const {
    question = '',
    response = '',
    chips = [],
    hasCTA = false,
    ctaLabels = [],
    isHinglish = false,
    module = '',
    expectedBehaviour = '',
    keyPhrases = [],
  } = input

  const rules = [
    ruleSourcingGuard({ question }),
    ruleNoFallback({ response, expectedBehaviour }),
    ruleLanguage({ response, question, isHinglish }),
    ruleMinLength({ response, module, expectedBehaviour }),
    ruleCTA({ hasCTA, ctaLabels, expectedBehaviour, module }),
    ruleNoCrossProduct({ response, module }),
    ruleEscalationCorrectness({ response, expectedBehaviour }),
    ruleKeywordMatch({ response, expectedBehaviour }),
  ]

  // Sourcing skip overrides everything
  const sourcingRule = rules.find(r => r.rule === 'SOURCING_GUARD')
  if (sourcingRule?.status === 'SKIP') {
    return {
      verdict: 'SOURCING_SKIP',
      verdictColor: '#f59e0b',
      rules,
      summary: 'Query is out of scope (Sourcing/apply intent) — skipped',
      confidence: null,
    }
  }

  const fails    = rules.filter(r => r.status === 'FAIL')
  const reviews  = rules.filter(r => r.status === 'REVIEW')
  const kwRule   = rules.find(r => r.rule === 'KEYWORD_MATCH')
  const confidence = kwRule?.confidence ?? null

  let verdict, verdictColor, summary

  if (fails.length > 0) {
    verdict = 'FAIL'
    verdictColor = '#ef4444'
    summary = `Failed ${fails.length} rule(s): ${fails.map(r => r.rule).join(', ')}`
  } else if (reviews.length > 0) {
    verdict = 'REVIEW'
    verdictColor = '#f59e0b'
    summary = `${reviews.length} rule(s) need manual review: ${reviews.map(r => r.rule).join(', ')}`
  } else {
    verdict = 'PASS'
    verdictColor = '#22c55e'
    summary = `All ${rules.length} rules passed`
  }

  return { verdict, verdictColor, rules, summary, confidence }
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
// Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runVerdict, MODULE_MIN_LENGTH, FALLBACK_PATTERNS, SOURCING_PATTERNS }
}
// Browser
if (typeof window !== 'undefined') {
  window.BLUVerdict = { runVerdict }
}
