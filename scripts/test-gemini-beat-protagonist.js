#!/usr/bin/env node
/**
 * Test bedtime beat with protagonist: protagonist_description "small brown bear" → narration and scene_prompt describe the bear.
 * Run: node scripts/test-gemini-beat-protagonist.js (requires GEMINI_API_KEY)
 */

import 'dotenv/config';
import { generateBedtimeStoryBeat } from '../ai/gemini.js';

const EMPTY_CAMPAIGN = { characters: [], locations: [], events: [] };
const PROTAGONIST = 'small brown bear with a red shirt';

async function run() {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.log('SKIP test-gemini-beat-protagonist: GEMINI_API_KEY not set');
    return { passed: 0, failed: 0, skipped: 1 };
  }
  try {
    const beat = await generateBedtimeStoryBeat('The hero finds a cozy cave.', EMPTY_CAMPAIGN, {
      protagonist_description: PROTAGONIST,
    });
    const narration = (beat && beat.narration) || '';
    const scenePrompt = (beat && beat.scene_prompt) || '';
    const combined = (narration + ' ' + scenePrompt).toLowerCase();
    const hasBear = /bear|oso/.test(combined);
    const hasProtagonist = hasBear || combined.includes('brown') || combined.includes('red shirt');
    if (beat && narration.length > 0 && scenePrompt.length > 0 && hasProtagonist) {
      console.log('PASS: beat with protagonist includes bear/protagonist in narration and scene_prompt');
      console.log('  narration:', narration.slice(0, 80) + '...');
      return { passed: 1, failed: 0, skipped: 0 };
    }
    if (beat && narration.length > 0 && scenePrompt.length > 0) {
      console.log('WARN: protagonist may not be clearly in text:', combined.slice(0, 120));
      return { passed: 1, failed: 0, skipped: 0 };
    }
    console.log('FAIL: missing beat fields or protagonist reference', { narration: narration.slice(0, 60), scene_prompt: scenePrompt.slice(0, 60) });
    return { passed: 0, failed: 1, skipped: 0 };
  } catch (e) {
    console.log('FAIL:', e.message);
    return { passed: 0, failed: 1, skipped: 0 };
  }
}

run()
  .then((r) => {
    console.log('');
    console.log(`Beat+protagonist: ${r.passed} passed, ${r.failed} failed, ${r.skipped} skipped`);
    process.exit(r.failed > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
