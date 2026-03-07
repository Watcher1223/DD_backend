#!/usr/bin/env node
/**
 * Test character injection beat: given "adult with glasses", get 1–2 sentence "traveler appears" beat with narration + scene_prompt.
 * Run: node scripts/test-gemini-character-injection.js (requires GEMINI_API_KEY)
 */

import 'dotenv/config';
import { generateCharacterInjectionBeat } from '../ai/gemini.js';

async function run() {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.log('SKIP test-gemini-character-injection: GEMINI_API_KEY not set');
    return { passed: 0, failed: 0, skipped: 1 };
  }
  const description = 'adult with glasses, friendly expression';
  const context = 'magical forest clearing';
  try {
    const beat = await generateCharacterInjectionBeat(description, context);
    const hasNarration = beat && typeof beat.narration === 'string' && beat.narration.length > 0;
    const hasScenePrompt = beat && typeof beat.scene_prompt === 'string' && beat.scene_prompt.length > 0;
    if (hasNarration && hasScenePrompt) {
      console.log('PASS: character injection beat has narration and scene_prompt');
      console.log('  narration:', beat.narration.slice(0, 80) + '...');
      return { passed: 1, failed: 0, skipped: 0 };
    }
    console.log('FAIL: missing narration or scene_prompt', beat);
    return { passed: 0, failed: 1, skipped: 0 };
  } catch (e) {
    console.log('FAIL:', e.message);
    return { passed: 0, failed: 1, skipped: 0 };
  }
}

run()
  .then((r) => {
    console.log('');
    console.log(`Character injection: ${r.passed} passed, ${r.failed} failed, ${r.skipped} skipped`);
    process.exit(r.failed > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
