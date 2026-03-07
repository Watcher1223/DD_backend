#!/usr/bin/env node
/**
 * Test emotion from frame: yawn/laugh/scared frames → emotion + mood + intensity + detected_events (array).
 * Run: node scripts/test-gemini-emotion.js (requires GEMINI_API_KEY and FIXTURE_IMAGE_BASE64 or scripts/fixtures/sample.png)
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { analyzeEmotionFromFrame } from '../vision/emotion_analysis.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIN_BASE64_LEN = 200;

function getFixtureBase64() {
  const env = process.env.FIXTURE_IMAGE_BASE64;
  if (env && typeof env === 'string' && env.length >= MIN_BASE64_LEN) return env.trim();
  const path = join(__dirname, 'fixtures', 'sample.png');
  if (existsSync(path)) {
    const base64 = readFileSync(path).toString('base64');
    if (base64.length >= MIN_BASE64_LEN) return base64;
  }
  return null;
}

async function run() {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.log('SKIP test-gemini-emotion: GEMINI_API_KEY not set');
    return { passed: 0, failed: 0, skipped: 1 };
  }
  const frame = getFixtureBase64();
  if (!frame) {
    console.log('SKIP test-gemini-emotion: no fixture (set FIXTURE_IMAGE_BASE64 or add scripts/fixtures/sample.png)');
    return { passed: 0, failed: 0, skipped: 1 };
  }
  try {
    const result = await analyzeEmotionFromFrame(frame);
    const hasEmotion = result && typeof result.emotion === 'string';
    const hasMood = result && typeof result.mood === 'string';
    const hasIntensity = typeof result?.intensity === 'number';
    const hasEvents = Array.isArray(result?.detected_events);
    if (hasEmotion && hasMood && hasIntensity && hasEvents) {
      console.log('PASS: emotion from frame has emotion, mood, intensity, detected_events');
      console.log('  emotion:', result.emotion, 'mood:', result.mood, 'intensity:', result.intensity, 'detected_events:', result.detected_events);
      return { passed: 1, failed: 0, skipped: 0 };
    }
    console.log('FAIL: missing fields', result);
    return { passed: 0, failed: 1, skipped: 0 };
  } catch (e) {
    console.log('FAIL:', e.message);
    return { passed: 0, failed: 1, skipped: 0 };
  }
}

run()
  .then((r) => {
    console.log('');
    console.log(`Emotion: ${r.passed} passed, ${r.failed} failed, ${r.skipped} skipped`);
    process.exit(r.failed > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
