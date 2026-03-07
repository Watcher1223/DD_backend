#!/usr/bin/env node
/**
 * Flow test: story session + stage vision + Chroma (and optional LiveKit token).
 * Run with server already up: npm run dev (then in another terminal: npm run test:flow)
 *
 * 1. WebSocket connect → subscribe story_audio → wait 500ms
 * 2. POST /api/story/stop (cleanup), then POST /api/story/start
 * 3. (Optional) GET /api/livekit/status; if configured, POST /api/livekit/token { role: 'publisher' }
 * 4. POST /api/story/stage-vision with fixture image; assert 200, people_count, new_entrant; check WS for character_injection when new entrant
 * 5. Second POST /api/story/stage-vision (same frame) to exercise Chroma re-id
 * 6. POST /api/story/stop
 *
 * Prerequisites: GEMINI_API_KEY; fixture from FIXTURE_IMAGE_BASE64 or scripts/fixtures/sample.png.
 */

import 'dotenv/config';
import WebSocket from 'ws';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '4300', 10);
const BASE = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}`;
const MIN_BASE64_LEN = 200;

let passed = 0;
let failed = 0;
let skipped = 0;
const wsMessages = [];

function log(msg) {
  const ts = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(`[${ts}] ${msg}`);
}

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

function runStep(name, fn) {
  return fn().then(() => {
    passed++;
    log(`PASS: ${name}`);
    return true;
  }).catch((err) => {
    failed++;
    log(`FAIL: ${name} — ${err.message}`);
    return false;
  });
}

function runStepSkip(name, condition, fn) {
  if (condition) {
    skipped++;
    log(`SKIP: ${name}`);
    return Promise.resolve(true);
  }
  return runStep(name, fn);
}

async function main() {
  console.log('');
  console.log('  Flow test — story + stage vision + Chroma');
  console.log('  ────────────────────────────────────────');
  console.log(`  Server: ${BASE} (WS: ${WS_URL})`);
  console.log('');

  const ws = await new Promise((resolve, reject) => {
    const w = new WebSocket(WS_URL);
    w.on('open', () => resolve(w));
    w.on('error', reject);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      wsMessages.push(msg);
    } catch (_) {}
  });

  ws.send(JSON.stringify({ type: 'subscribe', channel: 'story_audio' }));
  log('WebSocket connected, subscribed story_audio.');
  await new Promise((r) => setTimeout(r, 500));

  // Cleanup any existing session
  try {
    await fetch(`${BASE}/api/story/stop`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 400));
  } catch (e) {
    log('Warning: could not stop existing session: ' + e.message);
  }

  // Step 1: Start story session
  await runStep('POST /api/story/start', async () => {
    const res = await fetch(`${BASE}/api/story/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeDescription: 'flow test theme' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`status ${res.status}: ${JSON.stringify(data)}`);
    return data;
  });

  if (failed > 0) {
    ws.close();
    console.log('');
    console.log(`  Flow test: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    console.log('');
    process.exit(1);
  }

  // Step 2: LiveKit status and token (optional)
  const livekitOk = await runStepSkip(
    'GET /api/livekit/status + POST /api/livekit/token',
    !process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY,
    async () => {
      const statusRes = await fetch(`${BASE}/api/livekit/status`);
      const statusData = await statusRes.json().catch(() => ({}));
      if (!statusRes.ok) throw new Error(`status ${statusRes.status}`);
      if (!statusData.configured) throw new Error('LiveKit not configured');
      const tokenRes = await fetch(`${BASE}/api/livekit/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'publisher' }),
      });
      const tokenData = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}: ${JSON.stringify(tokenData)}`);
      if (!tokenData.token || !tokenData.roomName || !tokenData.url) throw new Error('missing token, roomName, or url');
      return tokenData;
    }
  );
  if (!livekitOk && failed > 0) {
    ws.close();
    console.log('');
    console.log(`  Flow test: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    console.log('');
    process.exit(1);
  }

  // Step 3: Stage vision with fixture
  const frame = getFixtureBase64();
  if (!frame) {
    skipped++;
    log('SKIP: POST /api/story/stage-vision (no fixture; set FIXTURE_IMAGE_BASE64 or add scripts/fixtures/sample.png)');
  } else if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    skipped++;
    log('SKIP: POST /api/story/stage-vision (GEMINI_API_KEY not set)');
  } else {
    const countBefore = wsMessages.length;
    await runStep('POST /api/story/stage-vision (first frame)', async () => {
      const res = await fetch(`${BASE}/api/story/stage-vision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frame }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`status ${res.status}: ${data.error || data.details || JSON.stringify(data)}`);
      if (typeof data.people_count !== 'number') throw new Error('missing people_count');
      if (typeof data.new_entrant !== 'boolean') throw new Error('missing new_entrant');
      if (data.new_entrant && data.character_beat) {
        await new Promise((r) => setTimeout(r, 800));
        const injections = wsMessages.slice(countBefore).filter((m) => m.type === 'character_injection');
        if (injections.length === 0) throw new Error('expected character_injection on WS when new_entrant and character_beat');
      }
      return data;
    });

    if (failed === 0) {
      await runStep('POST /api/story/stage-vision (second frame, Chroma re-id)', async () => {
        const res = await fetch(`${BASE}/api/story/stage-vision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frame }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`status ${res.status}: ${data.error || data.details || JSON.stringify(data)}`);
        if (typeof data.people_count !== 'number') throw new Error('missing people_count');
        return data;
      });
    }
  }

  // Step 4: Stop session
  await runStep('POST /api/story/stop', async () => {
    const res = await fetch(`${BASE}/api/story/stop`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`status ${res.status}: ${JSON.stringify(data)}`);
    return data;
  });

  ws.close();
  console.log('');
  console.log(`  Flow test: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
