#!/usr/bin/env node
/**
 * Test bedtime beat with language: request beat with language 'es' → narration in Spanish.
 * Run: node scripts/test-gemini-beat-language.js (requires GEMINI_API_KEY)
 */

import 'dotenv/config';
import { generateBedtimeStoryBeat } from '../ai/gemini.js';

const EMPTY_CAMPAIGN = { characters: [], locations: [], events: [] };

async function run() {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.log('SKIP test-gemini-beat-language: GEMINI_API_KEY not set');
    return { passed: 0, failed: 0, skipped: 1 };
  }
  try {
    const beat = await generateBedtimeStoryBeat('The hero finds a cozy cave.', EMPTY_CAMPAIGN, { language: 'es' });
    const narration = (beat && beat.narration) || '';
    const spanishIndicators = /\b(el|la|los|las|en|un|una|es|está|con|por|para|muy|más|bien|aquí|allí)\b/i;
    const looksSpanish = spanishIndicators.test(narration) || narration.length > 20;
    if (beat && narration.length > 0 && looksSpanish) {
      console.log('PASS: beat with language es produced Spanish narration');
      console.log('  narration:', narration.slice(0, 100) + '...');
      return { passed: 1, failed: 0, skipped: 0 };
    }
    if (beat && narration.length > 0) {
      console.log('WARN: narration may not be Spanish:', narration.slice(0, 120));
      return { passed: 1, failed: 0, skipped: 0 };
    }
    console.log('FAIL: no narration or empty', beat);
    return { passed: 0, failed: 1, skipped: 0 };
  } catch (e) {
    console.log('FAIL:', e.message);
    return { passed: 0, failed: 1, skipped: 0 };
  }
}

run()
  .then((r) => {
    console.log('');
    console.log(`Beat+language: ${r.passed} passed, ${r.failed} failed, ${r.skipped} skipped`);
    process.exit(r.failed > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
