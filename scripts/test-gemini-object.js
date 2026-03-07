#!/usr/bin/env node
/**
 * Test object detection: frame with doll/toy → objects array and optional protagonist_description.
 * Run: node scripts/test-gemini-object.js (requires GEMINI_API_KEY and FIXTURE_IMAGE_BASE64 or scripts/fixtures/sample.png)
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { detectToyInFrame } from '../vision/object_detection.js';

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
    console.log('SKIP test-gemini-object: GEMINI_API_KEY not set');
    return { passed: 0, failed: 0, skipped: 1 };
  }
  const frame = getFixtureBase64();
  if (!frame) {
    console.log('SKIP test-gemini-object: no fixture (set FIXTURE_IMAGE_BASE64 or add scripts/fixtures/sample.png)');
    return { passed: 0, failed: 0, skipped: 1 };
  }
  try {
    const result = await detectToyInFrame(frame);
    const hasObjects = Array.isArray(result?.objects);
    if (hasObjects) {
      console.log('PASS: object detection returns objects array');
      console.log('  objects:', result.objects?.length, 'protagonist_description:', result.protagonist_description ?? 'n/a');
      return { passed: 1, failed: 0, skipped: 0 };
    }
    console.log('FAIL: missing objects array', result);
    return { passed: 0, failed: 1, skipped: 0 };
  } catch (e) {
    console.log('FAIL:', e.message);
    return { passed: 0, failed: 1, skipped: 0 };
  }
}

run()
  .then((r) => {
    console.log('');
    console.log(`Object detection: ${r.passed} passed, ${r.failed} failed, ${r.skipped} skipped`);
    process.exit(r.failed > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
