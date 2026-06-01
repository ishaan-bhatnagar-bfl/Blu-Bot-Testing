/**
 * BLU Bot — Semantic Scorer
 * TF-IDF cosine similarity — replaces keyword overlap in KEYWORD_MATCH rule.
 * Pure JS, no dependencies, ~1ms per comparison.
 *
 * Usage:
 *   const { semanticScore } = require('./semantic_scorer')
 *   const { score, verdict, reason } = semanticScore(expectedBehaviour, botResponse)
 */

// Financial domain stopwords — excluded from scoring
const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','shall','can','need',
  'this','that','these','those','it','its','i','you','we','they','he','she',
  'your','our','my','his','her','their','please','note','also','however',
  'below','above','following','using','via','through','from','into','onto',
  // Keep: emi, card, loan, network — they are meaningful discriminators
  'bajaj','finserv','finance','bank',
  'click','here','tap','link','visit','page','app',
  'cta','label','android','https','http','www',
])

// Domain synonym map — expands financial terms before scoring
const SYNONYMS = {
  'withdraw':    ['drawdown','withdrawal'],
  'drawdown':    ['withdraw','withdrawal'],
  'block':       ['freeze','deactivate','stop'],
  'freeze':      ['block','deactivate'],
  'mandate':     ['payment','account'],
  'foreclose':   ['closure','close','preclosure'],
  'foreclosure': ['foreclose','close','preclosure'],
  'instalment':  ['emi','payment','monthly'],
  'limit':       ['amount','sanctioned','approved'],
  'relation':    ['relations','product','account','associated'],
  'relations':   ['relation','product','account','associated'],
  'nominee':     ['beneficiary','assignee'],
  'maturity':    ['tenure','period','duration'],
  'penalty':     ['charge','fee','penal'],
  'overdue':     ['pending','due','outstanding'],
  'statement':   ['document','report','certificate'],
  // FIX #3: product name synonyms — bot uses different names than KB
  'network':     ['emi','insta'],
  'insta':       ['network','emi'],
  'digital':     ['network','emi','insta'],
  'card':        ['cards'],
  'cards':       ['card'],
  'transaction': ['payment','purchase','shopping'],
  'purchase':    ['transaction','payment','shopping','buy'],
  'buy':         ['purchase','transaction','payment'],
  'shop':        ['purchase','buy','transaction'],
}

function tokenize(text) {
  const base = (text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\d+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w))
  // Expand with synonyms
  const expanded = [...base]
  base.forEach(w => { if (SYNONYMS[w]) expanded.push(...SYNONYMS[w]) })
  return [...new Set(expanded)]
}

function tfidfVector(tokens, vocab) {
  const tf  = {}
  const total = tokens.length || 1
  tokens.forEach(w => { tf[w] = (tf[w] || 0) + 1 })
  const vec = {}
  vocab.forEach(w => {
    const termFreq  = (tf[w] || 0) / total
    // IDF: boost rare terms, penalise common ones
    const inDoc     = tokens.includes(w) ? 1 : 0
    const idf       = 1 + Math.log(2 / (1 + inDoc))
    vec[w] = termFreq * idf
  })
  return vec
}

function cosineSim(v1, v2, vocab) {
  let dot = 0, mag1 = 0, mag2 = 0
  vocab.forEach(w => {
    dot  += (v1[w] || 0) * (v2[w] || 0)
    mag1 += (v1[w] || 0) ** 2
    mag2 += (v2[w] || 0) ** 2
  })
  return dot / (Math.sqrt(mag1) * Math.sqrt(mag2) || 1)
}

/**
 * Score bot response against KB expected behaviour.
 * Returns: { score: 0-1, confidence: 0-100, verdict: 'PASS'|'REVIEW'|'FAIL', reason }
 */
function semanticScore(expectedBehaviour, botResponse) {
  const t1   = tokenize(expectedBehaviour)
  const t2   = tokenize(botResponse)

  // Edge cases
  if (!t1.length) return { score: 0, confidence: 50, verdict: 'REVIEW', reason: 'No scoreable content in KB answer' }
  if (!t2.length) return { score: 0, confidence: 0,  verdict: 'FAIL',   reason: 'Bot response is empty or contains only stopwords' }

  const vocab = [...new Set([...t1, ...t2])]
  const v1    = tfidfVector(t1, vocab)
  const v2    = tfidfVector(t2, vocab)
  const score = cosineSim(v1, v2, vocab)

  const confidence = Math.round(score * 100)

  // Thresholds tuned on BLU Bot financial domain
  // PASS: >0.25 — meaningful semantic overlap
  // REVIEW: 0.10-0.25 — partial match, needs human check
  // FAIL: <0.10 — essentially unrelated responses
  let verdict, reason
  if (score > 0.25) {
    verdict = 'PASS'
    reason  = `Semantic similarity ${confidence}% — response aligns with KB answer`
  } else if (score > 0.10) {
    verdict = 'REVIEW'
    reason  = `Semantic similarity ${confidence}% — partial match, manual review recommended`
  } else {
    verdict = 'FAIL'
    reason  = `Semantic similarity ${confidence}% — response does not match KB answer content`
  }

  return { score, confidence, verdict, reason }
}

// ── Self-test ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const tests = [
    ['EMI cards cannot be used for vehicle financing loans',
     'Yes you can purchase a bike using the EMI Card. Are you looking to buy online?', 'FAIL'],
    ['Your EMI card limit is based on credit profile',
     'Your EMI Network Card limit is ₹2.5 lakhs based on your credit assessment.', 'PASS'],
    ['Flexi drawdown can be done via the app. Available limit shown in Your Relations',
     'You can withdraw money from your Personal Flexi Loan by logging into the app.', 'PASS'],
    ['FD interest rate is 7.4% per annum for general customers',
     'The current fixed deposit rate is 7.40% per annum for regular customers.', 'PASS'],
    ['To block your EMI card visit the EMI Card page using the link below',
     'Please select the relation to move further', 'FAIL'],
    ['Gold loan cannot be applied online must visit branch',
     'We are facing a temporary issue please click retry', 'FAIL'],
  ]
  console.log('\n🧪 Semantic Scorer Self-Test\n')
  let pass = 0
  tests.forEach(([exp, bot, expected]) => {
    const r  = semanticScore(exp, bot)
    const ok = r.verdict === expected
    if (ok) pass++
    console.log(`  ${ok?'✓':'✗'} ${expected} → got ${r.verdict} (${r.confidence}%)`)
    console.log(`    ${r.reason}`)
  })
  console.log(`\n  ${pass}/${tests.length} correct\n`)
}

module.exports = { semanticScore, tokenize }
