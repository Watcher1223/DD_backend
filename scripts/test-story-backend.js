#!/usr/bin/env node
/**
 * Local backend test for bedtime story (Lyria RealTime).
 * Run with server already up: npm run dev (then in another terminal: node scripts/test-story-backend.js)
 *
 * 1. Connects WebSocket to server
 * 2. Sends subscribe to story_audio
 * 3. Waits 500ms, then POST /api/story/start
 * 4. Counts incoming audio_chunk messages for 15 seconds
 * 5. POST /api/story/stop and prints summary
 *
 * If you see "Received N chunks" with N > 0, backend + broadcast are working; issue is likely browser-side.
 */

import WebSocket from 'ws';

const PORT = parseInt(process.env.PORT || '4300', 10);
const BASE = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}`;
const RUN_SECONDS = 15;

let chunksReceived = 0;
let ws = null;
let timeoutId = null;

function log(msg) {
  const ts = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(`[${ts}] ${msg}`);
}

async function stopSession() {
  try {
    const res = await fetch(`${BASE}/api/story/stop`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    log(`POST /api/story/stop → ${res.status} ${JSON.stringify(data)}`);
  } catch (e) {
    log('Stop request failed: ' + e.message);
  }
}

async function main() {
  console.log('');
  console.log('  Bedtime story — local backend test');
  console.log('  ─────────────────────────────────');
  console.log(`  Server: ${BASE} (WS: ${WS_URL})`);
  console.log(`  Will run for ${RUN_SECONDS}s then stop.`);
  console.log('');

  // Stop any existing session so this test starts a clean one
  try {
    await fetch(`${BASE}/api/story/stop`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 800));
  } catch (e) {
    log('Warning: could not stop existing session: ' + e.message);
  }

  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);

    ws.on('open', async () => {
      log('WebSocket connected.');
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'story_audio' }));
      log('Sent subscribe story_audio.');
      await new Promise((r) => setTimeout(r, 500));

      try {
        const res = await fetch(`${BASE}/api/story/start`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        log(`POST /api/story/start → ${res.status} ${JSON.stringify(data)}`);
        if (!res.ok) {
          log('Start failed. Exiting.');
          ws.close();
          return resolve();
        }
      } catch (e) {
        log('Start request failed: ' + e.message);
        ws.close();
        return resolve();
      }

      log('Listening for audio_chunk messages…');
      timeoutId = setTimeout(async () => {
        await stopSession();
        ws.close();
        console.log('');
        console.log('  Result: received ' + chunksReceived + ' audio chunks from server.');
        if (chunksReceived === 0) {
          console.log('  → No chunks: check server logs for "Subscriber added" and "Broadcasting story audio".');
        } else {
          console.log('  → Backend and broadcast are working; if browser has no sound, check client subscribe + Web Audio.');
        }
        console.log('');
        resolve();
      }, RUN_SECONDS * 1000);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'audio_chunk' && msg.payload) {
          chunksReceived++;
          if (chunksReceived <= 3 || chunksReceived % 20 === 0) {
            log('Chunk #' + chunksReceived + ' (payload length ' + (msg.payload?.length || 0) + ')');
          }
        } else if (msg.type === 'music_session_ended') {
          log('Server sent music_session_ended.');
        }
      } catch (_) {}
    });

    ws.on('error', (err) => {
      log('WebSocket error: ' + err.message);
      if (timeoutId) clearTimeout(timeoutId);
      reject(err);
    });

    ws.on('close', () => {
      log('WebSocket closed.');
    });
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
