#!/usr/bin/env node
/**
 * Test: (1) Consistent video — multiple story beats in sequence each return narration + image.
 *       (2) New character in video — after stage-vision detects a new entrant, the next beat
 *       can include them (stage characters are passed to Gemini).
 *
 * Run with server up: npm run dev (then: node scripts/test-video-and-new-character.js)
 *
 * Flow:
 * 1. POST /api/story/configure, POST /api/story/start
 * 2. Consistent video: 3x POST /api/story/beat with "What happens next?" — assert narration + image each time
 * 3. (Optional) POST /api/story/stage-vision with fixture — if new_entrant, next beat gets stage_characters
 * 4. 1x POST /api/story/beat "What happens next?" — assert success (and that we got narration + image)
 * 5. POST /api/story/stop
 *
 * Prerequisites: GEMINI_API_KEY. Optional: FIXTURE_IMAGE_BASE64 or scripts/fixtures/sample.png for stage-vision step.
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '4300', 10);
const BASE = `http://localhost:${PORT}`;
const MIN_BASE64_LEN = 200;
const BEAT_COUNT_VIDEO = 3;

let passed = 0;
let failed = 0;
let skipped = 0;

function log(msg) {
  const ts = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(`[${ts}] ${msg}`);
}

function getFixtureBase64() {
  const env = process.env.FIXTURE_IMAGE_BASE64;
  if (env && typeof env === 'string' && env.length >= MIN_BASE64_LEN) return env.trim();
  const fixturePath = join(__dirname, 'fixtures', 'sample.png');
  if (existsSync(fixturePath)) {
    const base64 = readFileSync(fixturePath).toString('base64');
    if (base64.length >= MIN_BASE64_LEN) return base64;
  }
  return null;
}

function runStep(name, fn) {
  return fn()
    .then(() => {
      passed++;
      log(`PASS: ${name}`);
      return true;
    })
    .catch((err) => {
      failed++;
      log(`FAIL: ${name} — ${err.message}`);
      return false;
    });
}

async function main() {
  console.log('');
  console.log('  Test: Consistent video + new character in video');
  console.log('  ──────────────────────────────────────────────');
  console.log(`  Server: ${BASE}`);
  console.log('');

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    log('SKIP: GEMINI_API_KEY not set');
    skipped++;
    console.log('');
    console.log(`  Result: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    console.log('');
    process.exit(0);
    return;
  }

  // Cleanup any existing session
  try {
    await fetch(`${BASE}/api/story/stop`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 400));
  } catch (e) {
    log('Warning: could not stop existing session: ' + e.message);
  }

  await runStep('POST /api/story/configure', async () => {
    const res = await fetch(`${BASE}/api/story/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childName: 'Test Child', childAge: 5 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`status ${res.status}: ${JSON.stringify(data)}`);
    return data;
  });

  if (failed > 0) {
    console.log('');
    console.log(`  Result: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    console.log('');
    process.exit(1);
  }

  await runStep('POST /api/story/start', async () => {
    const res = await fetch(`${BASE}/api/story/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeDescription: 'magical forest' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`status ${res.status}: ${JSON.stringify(data)}`);
    return data;
  });

  if (failed > 0) {
    await fetch(`${BASE}/api/story/stop`, { method: 'POST' }).catch(() => {});
    console.log('');
    console.log(`  Result: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    console.log('');
    process.exit(1);
  }

  // Consistent video: N beats in sequence, each must have narration + image
  for (let i = 0; i < BEAT_COUNT_VIDEO; i++) {
    await runStep(`POST /api/story/beat (video ${i + 1}/${BEAT_COUNT_VIDEO})`, async () => {
      const res = await fetch(`${BASE}/api/story/beat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'What happens next?' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`status ${res.status}: ${data.error || data.details || JSON.stringify(data)}`);
      const narration = data.narration;
      const imageUrl = data.image?.imageUrl || data.imageUrl;
      if (!narration || typeof narration !== 'string' || narration.length < 5) {
        throw new Error('missing or too short narration');
      }
      if (!imageUrl || typeof imageUrl !== 'string') {
        throw new Error('missing image (imageUrl or image.imageUrl)');
      }
      log(`  → narration: ${narration.slice(0, 60)}…`);
      return data;
    });
    if (failed > 0) break;
  }

  // Optional: stage-vision with fixture to simulate new character entering
  const frame = getFixtureBase64();
  if (frame && failed === 0) {
    await runStep('POST /api/story/stage-vision (new character)', async () => {
      const res = await fetch(`${BASE}/api/story/stage-vision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frame, generateImage: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`status ${res.status}: ${data.error || data.details || JSON.stringify(data)}`);
      if (data.new_entrant && data.character_beat) {
        log(`  → new_entrant detected, character_beat present (next beat can include them)`);
      }
      return data;
    });
  } else if (!frame) {
    skipped++;
    log('SKIP: POST /api/story/stage-vision (no fixture; set FIXTURE_IMAGE_BASE64 or add scripts/fixtures/sample.png)');
  }

  // One more beat after (optional) new entrant — should still return narration + image
  if (failed === 0) {
    await runStep('POST /api/story/beat (after stage vision)', async () => {
      const res = await fetch(`${BASE}/api/story/beat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'What happens next?' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`status ${res.status}: ${data.error || data.details || JSON.stringify(data)}`);
      const narration = data.narration;
      const imageUrl = data.image?.imageUrl || data.imageUrl;
      if (!narration || typeof narration !== 'string') throw new Error('missing narration');
      if (!imageUrl || typeof imageUrl !== 'string') throw new Error('missing image');
      return data;
    });
  }

  await runStep('POST /api/story/stop', async () => {
    const res = await fetch(`${BASE}/api/story/stop`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`status ${res.status}: ${JSON.stringify(data)}`);
    return data;
  });

  console.log('');
  console.log(`  Result: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
