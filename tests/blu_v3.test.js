'use strict';
/**
 * BLU UAT v3.6 - Complete Fix Package
 * 
 * v3.6: Product-aware follow-ups, module filtering, context-aware scoring
 * v3.5: Message count before relation click
 */

const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const VERSION = 'v3.6';

const cfg = JSON.parse(fs.readFileSync(path.resolve('run_config.json'), 'utf-8'));
const allCases = JSON.parse(fs.readFileSync(path.resolve('data/blu_test_cases_v3.json'), 'utf-8'));

const THINKING_PHRASES = [
  'checking', 'hold on', 'kindly wait', 'just a moment',
  'working on it', 'confirming', 'please wait', 'one moment',
  'fetching', 'loading', 'processing',
];

function isThinkingState(text) {
  const lower = text.toLowerCase().trim();
  return THINKING_PHRASES.some(p => lower.includes(p)) && lower.length < 60;
}

function needsFollowUp(botReply) {
  const followUpPatterns = [
    /you('ll| will) need/i,
    /please provide/i,
    /provide.*loan amount/i,
    /specify.*product/i,
    /which.*loan/i,
    /select.*variant/i,
    /flexi hybrid/i,
    /chahiye/i,
    /chahiye hongi/i,
    /details chahiye/i,
    /batayein/i,
    /bataiye/i,
    /provide karein/i,
  ];
  
  return followUpPatterns.some(p => p.test(botReply));
}

function generateFollowUpData(botReply) {
  const lower = botReply.toLowerCase();
  
  // EMI Card specific
  if (lower.includes('emi card') || lower.includes('emi network')) {
    if (lower.includes('card number') || lower.includes('provide')) {
      return 'EMI Card number 5412 3456 7890 1234';
    }
    if (lower.includes('limit') || lower.includes('amount')) {
      return 'EMI Card limit 50000';
    }
  }
  
  // Health Card specific
  if (lower.includes('health card')) {
    if (lower.includes('card number')) {
      return 'Health Card number 6234 5678 9012 3456';
    }
  }
  
  // Fixed Deposit specific
  if (lower.includes('fixed deposit') || lower.includes('fd')) {
    if (lower.includes('amount') || lower.includes('tenure')) {
      return 'Fixed Deposit amount 10 lakh, tenure 5 years';
    }
  }
  
  // Loan variant selection
  if (lower.includes('variant')) {
    return 'Flexi Hybrid Term Loan';
  }
  
  // Loan type selection
  if (lower.includes('specify') || lower.includes('which')) {
    if (lower.includes('product') || lower.includes('loan')) {
      return 'Personal Loan';
    }
  }
  
  // Loan details (default)
  if (lower.includes('you') && lower.includes('need')) {
    return 'Loan amount 5 lakh, interest rate 12%, tenure 3 years';
  }
  
  if (lower.includes('loan amount') || lower.includes('interest') || 
      lower.includes('tenure') || lower.includes('chahiye')) {
    return 'Loan amount 5 lakh, interest rate 12%, tenure 3 years';
  }
  
  return null;
}

async function screenshot(page, label) {
  const p = `results/screenshots/${label}_${Date.now()}.png`;
  await page.screenshot({ path: p, fullPage: true }).catch(() => {});
  console.log(`  📸 ${p}`);
  return p;
}

async function clearAndType(page, locator, text) {
  await locator.waitFor({ state: 'visible', timeout: 30000 });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ force: true });
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text, { delay: 12 });
}

async function submitFromComposer(page, locator) {
  const method = await locator.evaluate(el => {
    let node = el;
    for (let i = 0; i < 9; i++) {
      const parent = node?.parentElement;
      if (!parent) break;
      for (const b of parent.querySelectorAll('button')) {
        if (!b.disabled) { b.click(); return 'button'; }
      }
      const rb = parent.querySelector('[role="button"]');
      if (rb) { rb.click(); return 'role-button'; }
      for (const img of parent.querySelectorAll('img')) {
        if (window.getComputedStyle(img).cursor === 'pointer') {
          img.click(); return 'img-pointer';
        }
      }
      const imgs = parent.querySelectorAll('img');
      if (imgs.length) { imgs[imgs.length - 1].click(); return 'img-last'; }
      node = parent;
    }
    return null;
  }).catch(() => null);
  if (!method) { await locator.press('Enter').catch(() => {}); return 'enter'; }
  return method;
}

async function dismissRetryIfNeeded(page, maxWaitSeconds = 40) {
  // Only dismiss if retry appears during THIS operation
  const btn = page.getByRole('button', { name: /^Retry$/i }).first();
  
  const isVisible = await btn.isVisible().catch(() => false);
  if (!isVisible) return false;
  
  console.log(`  🟠 Retry detected`);
  
  const maxAttempts = Math.ceil(maxWaitSeconds / 2);
  
  for (let i = 0; i < maxAttempts; i++) {
    const isEnabled = await btn.isEnabled().catch(() => false);
    
    if (isEnabled) {
      console.log(`    ✓ Retry clickable, dismissing`);
      await btn.click({ force: true });
      await page.waitForTimeout(2000);
      return true;
    } else {
      console.log(`    ⏳ Cooldown (${i * 2}s/${maxWaitSeconds}s)`);
      await page.waitForTimeout(2000);
    }
  }
  
  console.log(`    ⚠️  Retry never clickable after ${maxWaitSeconds}s`);
  return false;
}

async function dismissRetry(page) {
  // Quick dismiss for non-critical retries (backward compat)
  const btn = page.getByRole('button', { name: /^Retry$/i }).first();
  let attempts = 0;
  while (await btn.isVisible().catch(() => false) && attempts < 3) {
    const isEnabled = await btn.isEnabled().catch(() => false);
    if (isEnabled) {
      await btn.click({ force: true });
      await page.waitForTimeout(2000);
    } else {
      break; // Don't wait if disabled
    }
    attempts++;
  }
}

async function isConsentPending(page) {
  return await page.evaluate(() => {
    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    return checkboxes.some(cb => !cb.checked);
  }).catch(() => false);
}

async function acceptConsent(page, attempt) {
  const pending = await isConsentPending(page);
  if (!pending) return false;

  const checkbox  = page.locator('input[type="checkbox"]').first();
  const acceptBtn = page.locator('button.blu-primary-button').last();

  await checkbox.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);

  const box = await checkbox.boundingBox().catch(() => null);
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await checkbox.click({ force: true }).catch(() => {});
  }
  await page.waitForTimeout(400);

  const checked = await checkbox.evaluate(el => el.checked).catch(() => false);
  if (!checked) {
    await checkbox.evaluate(el => {
      el.checked = true;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }).catch(() => {});
    await page.waitForTimeout(400);
  }

  for (let w = 0; w < 6; w++) {
    await page.waitForTimeout(500);
    if (await acceptBtn.isEnabled().catch(() => false)) break;
  }

  await acceptBtn.scrollIntoViewIfNeeded().catch(() => {});
  await acceptBtn.click({ force: true });
  await page.waitForTimeout(2500);
  await dismissRetry(page);
  return true;
}

async function isInitialHomeReady(page) {
  const chipsVisible = await page
    .locator('text=What you can do next').first()
    .isVisible().catch(() => false);
  if (!chipsVisible) return false;

  const composerVisible = await page
    .locator('textarea, [contenteditable="true"]').first()
    .isVisible().catch(() => false);
  if (!composerVisible) return false;

  if (await page.getByRole('button', { name: /^Retry$/i }).first()
    .isVisible().catch(() => false)) return false;

  if (await isConsentPending(page)) return false;

  return true;
}

async function waitForHome(page) {
  await Promise.race([
    page.locator('input[type="checkbox"]').first()
      .waitFor({ state: 'attached', timeout: 15000 }),
    page.locator('text=What you can do next').first()
      .waitFor({ state: 'visible', timeout: 15000 }),
  ]).catch(() => {});

  for (let i = 1; i <= 20; i++) {
    await dismissRetry(page);
    if (await isInitialHomeReady(page)) {
      console.log(`  ✅ Home (${i})`);
      return;
    }
    if (await isConsentPending(page)) {
      await acceptConsent(page, i);
    } else {
      await page.waitForTimeout(1000);
    }
  }

  await screenshot(page, 'fail_home');
  throw new Error('Home not reached');
}

async function selectRelationChip(page, targetText) {
  console.log(`    🔧 "${targetText}"...`);
  
  await page.waitForTimeout(2000);
  
  const clicked = await page.evaluate((target) => {
    const allDivs = Array.from(document.querySelectorAll('div, button'));
    
    for (const el of allDivs) {
      const text = el.innerText || '';
      const isClickable = window.getComputedStyle(el).cursor === 'pointer' || 
                          el.tagName === 'BUTTON' ||
                          el.onclick;
      
      if (!isClickable) continue;
      
      if (text.trim() === target) {
        el.click();
        return text.trim();
      }
      
      if (target === 'AUTO') {
        if (text.includes('Active') || 
            text.includes('Closed') ||
            text.includes('PERSONAL') || 
            text.includes('LOAN') ||
            text.includes('EMI CARD') ||
            text.includes('Disbursal')) {
          el.click();
          return text.trim().slice(0, 30);
        }
      }
    }
    return null;
  }, targetText).catch(() => null);
  
  if (clicked) {
    console.log(`      ✓ "${clicked}"`);
    await page.waitForTimeout(15000); // INCREASED to 15s
    await dismissRetry(page);
    return true;
  } else {
    console.log(`      ✗ Not found`);
    return false;
  }
}

async function selectRelationByL1(page, l1Category) {
  console.log(`  🔧 Relation: ${l1Category}`);
  
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
  
  const needsRelation = bodyText.includes('Please select the relation') ||
                       bodyText.includes('select the product to move further');
  
  if (!needsRelation) {
    console.log('    ↳ Not needed');
    return false;
  }
  
  const showingLoanCards = bodyText.includes('Active') && 
                          (bodyText.includes('PERSONAL LOAN') || bodyText.includes('EMI CARD')) &&
                          bodyText.includes('Disbursal');
  
  if (showingLoanCards) {
    console.log('    ↳ Direct cards, selecting...');
    await selectRelationChip(page, 'AUTO');
    return true;
  }
  
  const l1Lower = l1Category.toLowerCase();
  let level1Chip = null;
  
  if (l1Lower.includes('loan')) level1Chip = 'Loan';
  else if (l1Lower.includes('card')) level1Chip = 'Cards';
  else if (l1Lower.includes('insurance')) level1Chip = 'Insurance';
  else if (l1Lower.includes('investment') || l1Lower.includes('deposit')) level1Chip = 'Investment';
  
  if (!level1Chip) {
    console.log('    ↳ Unknown L1');
    return false;
  }
  
  const clicked1 = await selectRelationChip(page, level1Chip);
  if (!clicked1) return false;
  
  await page.waitForTimeout(3000);
  
  const bodyText2 = await page.evaluate(() => document.body.innerText).catch(() => '');
  const needsLevel2 = bodyText2.includes('Active') || 
                     bodyText2.includes('Closed') || 
                     bodyText2.includes('PERSONAL LOAN') ||
                     bodyText2.includes('EMI CARD');
  
  if (needsLevel2) {
    console.log('    🔧 Level 2...');
    await selectRelationChip(page, 'AUTO');
  }
  
  return true;
}

async function botMessageCount(page) {
  return page.locator('.blu-bot-message.message').count().catch(() => 0);
}

async function waitForFinalBotReply(page, beforeCount, BOT_TIMEOUT) {
  const deadline = Date.now() + BOT_TIMEOUT;

  await expect.poll(() => botMessageCount(page), {
    timeout: BOT_TIMEOUT,
    intervals: [300, 500, 800, 1000],
  }).toBeGreaterThan(beforeCount);

  let lastText = '';
  let stableCount = 0;

  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);

    const last    = page.locator('.blu-bot-message.message').last();
    const current = (await last.innerText().catch(() => '')).trim();

    if (!current) {
      stableCount = 0;
      lastText = current;
      continue;
    }

    if (isThinkingState(current)) {
      console.log(`    ⏳ "${current}"`);
      stableCount = 0;
      lastText = current;
      continue;
    }

    if (current === lastText) {
      stableCount++;
      if (stableCount >= 2) {
        return current;
      }
    } else {
      stableCount = 1;
      lastText = current;
    }
  }

  return lastText;
}

function scoreResult(tc, botReply) {
  const reply = botReply.toLowerCase();
  
  // REAL USER: Quality-based scoring
  if (tc.variation_type === 'Real User') {
    let responseMatch = 'Fail';
    
    if (botReply.length >= 50) {
      const hasError = reply.includes('error') || 
                      reply.includes('something went wrong') ||
                      reply.includes('unable to process') ||
                      reply.includes('try again later');
      
      const isStuck = reply.includes('please select the relation') ||
                     reply.includes('select the product to move further');
      
      if (!hasError && !isStuck) {
        responseMatch = 'Pass';
      }
    }
    
    let ctaPresent = 'N/A';
    const hasAnyCTA = 
      reply.includes('click') || reply.includes('tap') || 
      reply.includes('apply') || reply.includes('visit') ||
      reply.includes('document center') || reply.includes('access') ||
      reply.includes('start') || reply.includes('raise') ||
      reply.includes('request');
    
    if (hasAnyCTA) {
      ctaPresent = 'Pass';
    }
    
    const overall = responseMatch === 'Pass' ? 'Pass' : 'Fail';
    return { responseMatch, ctaPresent, ctaTypeCorrect: 'N/A', overall, matchedKw: 'quality' };
  }
  
  // SYNTHETIC: Keyword-based
  const keywords  = (tc.expected_keywords || '').split('|').map(k => k.trim().toLowerCase()).filter(Boolean);
  const matchedKw = keywords.filter(k => reply.includes(k));
  
  const responseMatch = keywords.length === 0 ? 'Pass' :
    (matchedKw.length >= Math.ceil(keywords.length * 0.4) ? 'Pass' : 'Fail');

  let ctaPresent = 'N/A';
  if (tc.cta_expected === 'Yes') {
    const hasAnyCTA = 
      reply.includes('click') || reply.includes('tap') || 
      reply.includes('apply') || reply.includes('visit') ||
      reply.includes('document center') || reply.includes('access') ||
      reply.includes('start') || reply.includes('raise');
    
    ctaPresent = hasAnyCTA ? 'Pass' : 'Fail';
  }

  let ctaTypeCorrect = 'N/A';
  if (tc.cta_expected === 'Yes' && tc.cta_type) {
    ctaTypeCorrect = ctaPresent === 'Pass' ? 'Pass' : 'Fail';
  }

  const checks  = [responseMatch, ctaPresent, ctaTypeCorrect].filter(v => v !== 'N/A');
  const overall = checks.every(v => v === 'Pass') ? 'Pass' : 'Fail';
  return { responseMatch, ctaPresent, ctaTypeCorrect, overall, matchedKw: matchedKw.join(', ') };
}

test('BLU UAT', async ({ page, context }) => {
  const BLU_URL     = process.env.BLU_URL         || cfg.BLU_URL;
  const BLU_MOBILE  = process.env.BLU_MOBILE      || cfg.BLU_MOBILE;
  const BLU_OTP     = process.env.BLU_OTP         || cfg.BLU_OTP;
  const BATCH_SIZE  = parseInt(process.env.BATCH_SIZE      || cfg.BATCH_SIZE);
  const FILTER_L1   = process.env.FILTER_L1       || cfg.FILTER_L1        || '';
  const FILTER_VAR  = process.env.FILTER_VARIATION || cfg.FILTER_VARIATION || '';
  const FILTER_MOD  = process.env.FILTER_MODULE   || '';
  const DELAY_MS    = parseInt(process.env.DELAY_MS || cfg.DELAY_BETWEEN_MSGS_MS);
  const BOT_TIMEOUT = parseInt(cfg.BOT_REPLY_TIMEOUT_MS);

  let filtered = allCases;
  
  if (FILTER_L1) {
    filtered = filtered.filter(tc => tc.l1.toLowerCase() === FILTER_L1.toLowerCase());
  }
  
  if (FILTER_VAR) {
    filtered = filtered.filter(tc => tc.variation_type === FILTER_VAR);
  }
  
  if (FILTER_MOD) {
    filtered = filtered.filter(tc => tc.module === FILTER_MOD);
  }
  
  filtered = filtered.slice(0, BATCH_SIZE);
  
  console.log(`\n🔧 BLU UAT ${VERSION}`);
  console.log(`📋 ${filtered.length} test cases\n`);
  
  if (filtered.length === 0) return;

  fs.mkdirSync('results', { recursive: true });
  fs.mkdirSync('results/screenshots', { recursive: true });
  const RUN_TS       = new Date().toISOString().replace(/[:.]/g, '-');
  const RESULTS_FILE = `results/run_${RUN_TS}.json`;
  
  const runResults = { 
    version: VERSION,
    run_ts: RUN_TS, 
    total: filtered.length, 
    results: [] 
  };

  await context.grantPermissions(['geolocation'], { origin: new URL(BLU_URL).origin });
  await context.setGeolocation({ latitude: 18.5204, longitude: 73.8567 });

  console.log(`🚀 ${BLU_URL}`);
  await page.goto(BLU_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  await dismissRetry(page);

  console.log('🔐 Mobile...');
  const mobileBox = page.getByRole('textbox', { name: /enter your mobile number/i }).first();
  await mobileBox.waitFor({ state: 'visible', timeout: 40000 });
  await clearAndType(page, mobileBox, BLU_MOBILE);
  await submitFromComposer(page, mobileBox);

  await page.waitForTimeout(3000);
  
  console.log('🔐 OTP...');
  const otpBox = page.getByRole('textbox', { name: /otp|6.?digit/i }).first();
  await otpBox.waitFor({ state: 'visible', timeout: 20000 });
  await clearAndType(page, otpBox, BLU_OTP);
  await submitFromComposer(page, otpBox);

  await page.locator('text=/otp has been successfully validated/i').first()
    .waitFor({ state: 'visible', timeout: 35000 });
  console.log('✅ Validated\n');

  await waitForHome(page);

  if (filtered.length > 0) {
    await selectRelationByL1(page, filtered[0].l1);
  }

  const composer = page.locator('textarea, [contenteditable="true"]').first();
  await composer.waitFor({ state: 'visible', timeout: 30000 });
  console.log(`✅ Running ${filtered.length} tests\n`);

  let passed = 0, failed = 0;

  for (let i = 0; i < filtered.length; i++) {
    const tc = filtered[i];
    console.log(`\n[${i + 1}/${filtered.length}] ${tc.id} ${tc.variation_type}`);
    console.log(`  💬 "${tc.utterance}"`);

    await dismissRetry(page);
    if (await isConsentPending(page)) {
      await acceptConsent(page, 1);
    }

    let beforeCount = await botMessageCount(page);
    let beforeText = await page.locator('.blu-bot-message.message').last().innerText().catch(() => '');
    const startTime = Date.now();

    await clearAndType(page, composer, tc.utterance);
    await submitFromComposer(page, composer);

    let botReply = '';
    let timedOut = false;
    
    try {
      botReply = await waitForFinalBotReply(page, beforeCount, BOT_TIMEOUT);
    } catch {
      timedOut = true;
      await screenshot(page, `timeout_${tc.id}`);
    }

    let followUpCount = 0;
    while (!timedOut && botReply && needsFollowUp(botReply) && followUpCount < 3) {
      followUpCount++;
      console.log(`  🔄 Follow-up ${followUpCount}`);
      
      const followUpData = generateFollowUpData(botReply);
      if (!followUpData) {
        console.log('    ⚠️  No pattern');
        break;
      }
      
      console.log(`    📝 "${followUpData}"`);
      await page.waitForTimeout(2000);
      beforeCount = await botMessageCount(page);
      
      await clearAndType(page, composer, followUpData);
      await submitFromComposer(page, composer);
      
      try {
        botReply = await waitForFinalBotReply(page, beforeCount, BOT_TIMEOUT);
        console.log('    ✅ Response');
      } catch {
        console.log('    ⚠️  Timeout');
        timedOut = true;
        break;
      }
    }

    if (!timedOut && botReply) {
      const needsRelation = botReply.toLowerCase().includes('select the relation') ||
                           botReply.toLowerCase().includes('select the product');
      if (needsRelation) {
        console.log('  🔧 Relation requested');
        
        // Get count BEFORE clicking
        beforeCount = await botMessageCount(page);
        
        await selectRelationByL1(page, tc.l1);
        await page.waitForTimeout(15000);
        
        // Check if bot already responded (new message exists)
        const currentCount = await botMessageCount(page);
        if (currentCount > beforeCount) {
          console.log('  ✅ Bot responded during wait');
        } else {
          // No new message, check for retry
          await dismissRetryIfNeeded(page, 40);
          await page.waitForTimeout(10000);
        }
        
        try {
          botReply = await waitForFinalBotReply(page, beforeCount, BOT_TIMEOUT);
          console.log('  ✅ Final answer');
        } catch {
          console.log('  ⚠️  No reply');
          timedOut = true;
        }
      }
    }

    const elapsed = Date.now() - startTime;
    const scores  = timedOut
      ? { responseMatch: 'Fail', ctaPresent: 'N/A', ctaTypeCorrect: 'N/A', overall: 'Fail', matchedKw: '' }
      : scoreResult(tc, botReply);

    if (scores.overall === 'Pass') passed++; else failed++;
    const icon = scores.overall === 'Pass' ? '✅' : '❌';
    console.log(`  🤖 ${botReply.slice(0, 100)}${botReply.length > 100 ? '…' : ''}`);
    console.log(`  ${icon} ${scores.overall} | R:${scores.responseMatch} | CTA:${scores.ctaPresent}`);

    runResults.results.push({
      tc_id:          tc.id,
      variation:      tc.variation_type,
      utterance:      tc.utterance,
      bot_reply:      botReply.slice(0, 500),
      follow_ups:     followUpCount,
      elapsed_ms:     elapsed,
      overall:        scores.overall,
    });

    fs.writeFileSync(RESULTS_FILE, JSON.stringify(runResults, null, 2));
    await page.waitForTimeout(DELAY_MS);
  }

  runResults.passed    = passed;
  runResults.failed    = failed;
  runResults.pass_rate = `${((passed / filtered.length) * 100).toFixed(1)}%`;
  
  // Standalone pass rate (excludes context-dependent)
  const standalone = runResults.results.filter(r => !allCases.find(tc => tc.id === r.tc_id)?.requires_context);
  const standalonePassed = standalone.filter(r => r.overall === 'Pass').length;
  runResults.standalone_pass_rate = `${((standalonePassed / standalone.length) * 100).toFixed(1)}%`;
  runResults.standalone_total = standalone.length;
  
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(runResults, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`BLU UAT ${VERSION}`);
  console.log(`✅ ${passed}  ❌ ${failed}  Rate: ${runResults.pass_rate}`);
  console.log(`📄 ${RESULTS_FILE}`);
  console.log(`${'═'.repeat(50)}\n`);
});
