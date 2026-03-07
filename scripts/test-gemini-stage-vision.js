#!/usr/bin/env node
/**
 * Test stage vision: two images, second with more people → new_entrant and description.
 * Run: node scripts/test-gemini-stage-vision.js (requires GEMINI_API_KEY and two fixtures or one image used twice with different previousPeopleCount).
 * With one fixture: we call analyzeStageVision(frame, 0, new Set()) then (frame, 1, new Set(['adult_1'])).
 * If the same frame returns 1 person, second call with previousPeopleCount=1 gives new_entrant=false. So we need two different images for a real test.
 * This test uses ONE fixture and verifies the API returns people, new_entrant (boolean), and optional new_entrant_description.
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { analyzeStageVision } from '../vision/stage_vision.js';

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
    console.log('SKIP test-gemini-stage-vision: GEMINI_API_KEY not set');
    return { passed: 0, failed: 0, skipped: 1 };
  }
  const frame = getFixtureBase64();
  if (!frame) {
    console.log('SKIP test-gemini-stage-vision: no fixture (set FIXTURE_IMAGE_BASE64 or add scripts/fixtures/sample.png)');
    return { passed: 0, failed: 0, skipped: 1 };
  }
  try {
    const result = await analyzeStageVision(frame, 0, new Set());
    const hasPeople = Array.isArray(result?.people);
    const hasNewEntrant = typeof result?.new_entrant === 'boolean';
    if (hasPeople && hasNewEntrant) {
      console.log('PASS: stage vision returns people and new_entrant');
      console.log('  people:', result.people?.length, 'new_entrant:', result.new_entrant, 'new_entrant_description:', result.new_entrant_description ? 'present' : 'n/a');
      return { passed: 1, failed: 0, skipped: 0 };
    }
    console.log('FAIL: missing people or new_entrant', result);
    return { passed: 0, failed: 1, skipped: 0 };
  } catch (e) {
    console.log('FAIL:', e.message);
    return { passed: 0, failed: 1, skipped: 0 };
  }
}

run()
  .then((r) => {
    console.log('');
    console.log(`Stage vision: ${r.passed} passed, ${r.failed} failed, ${r.skipped} skipped`);
    process.exit(r.failed > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
