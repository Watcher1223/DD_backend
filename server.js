// ═══════════════════════════════════════════════
// LIVING WORLDS — Backend Server
// Real-Time AI Dungeon Master
// Express + WebSocket for live updates
// ═══════════════════════════════════════════════

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import gameRoutes from './routes/game.js';
import audioRoutes from './routes/audio.js';
import cameraRoutes from './routes/camera.js';
import speechRoutes from './routes/speech.js';
import storyRoutes from './routes/story.js';
import livekitRoutes from './routes/livekit.js';
import { initDb } from './db/index.js';
import { initChroma, isChromaEnabled } from './memory/chroma.js';
import { initV2VConnection, isV2VConfigured, getV2VStatus } from './services/v2v.js';
import { isVeoConfigured } from './ai/veo.js';

const PORT = parseInt(process.env.PORT || '4300', 10);

// ── Database ──
initDb();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Large limit for webcam frames

// Static files (test page)
app.use(express.static('public'));

// Redirect trailing-dot URL (some browsers/extensions request test-story-audio.html. → 404)
app.get('/test-story-audio.html.', (req, res) => res.redirect(302, '/test-story-audio.html'));

// Avoid 404 for favicon (browsers request it automatically)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ── WebSocket setup ──
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const wsClients = new Set();
/** Subscribers to bedtime story audio (Lyria RealTime PCM stream) */
const storyAudioSubscribers = new Set();
/** Subscribers to story video frames/clips (V2V + Veo) */
const storyVideoSubscribers = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[WS] Client connected (${wsClients.size} total)`);

  ws.on('message', (data) => {
    try {
      const raw = typeof data === 'string' ? data : (Buffer.isBuffer(data) ? data.toString() : null);
      const msg = raw ? JSON.parse(raw) : null;
      if (msg?.type === 'subscribe' && msg?.channel === 'story_audio') {
        storyAudioSubscribers.add(ws);
        console.log('[WS] Subscriber added to story_audio (total ' + storyAudioSubscribers.size + ')');
      }
      if (msg?.type === 'subscribe' && msg?.channel === 'story_video') {
        storyVideoSubscribers.add(ws);
        console.log('[WS] Subscriber added to story_video (total ' + storyVideoSubscribers.size + ')');
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    wsClients.delete(ws);
    storyAudioSubscribers.delete(ws);
    storyVideoSubscribers.delete(ws);
    console.log(`[WS] Client disconnected (${wsClients.size} total)`);
  });
});

// Broadcast function available to routes
app.locals.broadcast = (message) => {
  for (const ws of wsClients) {
    try {
      if (ws.readyState === 1) ws.send(message);
    } catch {}
  }
};

// Send Lyria RealTime PCM to story-audio subscribers (base64 JSON for compatibility)
app.locals.getStoryAudioSubscriberCount = () => storyAudioSubscribers.size;
app.locals.broadcastStoryAudio = (pcmBuffer) => {
  const payload = pcmBuffer.toString('base64');
  const n = storyAudioSubscribers.size;
  if (!app.locals._broadcastCount) app.locals._broadcastCount = 0;
  app.locals._broadcastCount++;
  if (n === 0) {
    if (app.locals._broadcastCount <= 5) console.log('[WS] No subscribers for story audio (chunk #' + app.locals._broadcastCount + ')');
  } else {
    if (app.locals._broadcastCount <= 5 || app.locals._broadcastCount % 20 === 0) {
      console.log('[WS] Broadcasting story audio to ' + n + ' subscriber(s), chunk #' + app.locals._broadcastCount + ', size=' + pcmBuffer.length);
    }
  }
  for (const ws of storyAudioSubscribers) {
    try {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'audio_chunk', payload, sampleRate: 48000, channels: 2 }));
      }
    } catch (_) {}
  }
};

app.locals.broadcastStoryAudioEnd = () => {
  for (const ws of storyAudioSubscribers) {
    try {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'music_session_ended' }));
      }
    } catch (_) {}
  }
};

// Send V2V transformed frame to story-video subscribers
app.locals.broadcastStoryVideoFrame = (frameBase64, metadata) => {
  const payload = JSON.stringify({ type: 'story_video_frame', frame: frameBase64, ...metadata });
  for (const ws of storyVideoSubscribers) {
    try {
      if (ws.readyState === 1) ws.send(payload);
    } catch (_) {}
  }
};

// Send Veo video clip notification to story-video subscribers
app.locals.broadcastStoryVideoClip = (clipData) => {
  const payload = JSON.stringify({ type: 'story_video_clip', ...clipData });
  for (const ws of storyVideoSubscribers) {
    try {
      if (ws.readyState === 1) ws.send(payload);
    } catch (_) {}
  }
};

// ── Routes ──
app.use('/api', audioRoutes);
app.use('/api', cameraRoutes);
app.use('/api', speechRoutes);
app.use('/api', gameRoutes);
app.use('/api', storyRoutes);
app.use('/api', livekitRoutes);

// ── Root ──
app.get('/', (req, res) => {
  res.json({
    name: 'Living Worlds — Bedtime Story Engine',
    version: '1.0.0',
    testAudio: 'GET /test-audio.html to verify narration + music playback',
    testStoryAudio: 'GET /test-story-audio.html to test bedtime story moods and emotions (Lyria RealTime)',
    endpoints: {
      storyConfigure: 'POST /api/story/configure',
      storyBeat: 'POST /api/story/beat',
      action: 'POST /api/action',
      dice: 'POST /api/dice',
      cameraAnalyze: 'POST /api/camera/analyze (character vision)',
      cameraPair: 'POST /api/camera/pair (generate phone pairing code)',
      cameraRemote: 'POST /api/camera/remote/:code (phone sends frame)',
      cameraProfiles: 'GET /api/camera/profiles (stored profiles)',
      speechTranscribe: 'POST /api/speech/transcribe (speech-to-text)',
      campaign: 'GET /api/campaign',
      campaigns: 'GET /api/campaigns, POST /api/campaigns',
      reset: 'POST /api/campaign/reset',
      moods: 'GET /api/moods',
      health: 'GET /api/health',
      audio: 'GET /api/audio?url=... (music proxy)',
      tts: 'GET /api/tts?text=... (narration speech)',
      musicGenerate: 'GET /api/music/generate?mood=... (Lyria 2)',
      storyStart: 'POST /api/story/start',
      storyStop: 'POST /api/story/stop',
      storyStatus: 'GET /api/story/status',
      storyExport: 'GET /api/story/export',
      musicUpdate: 'POST /api/music/update',
      livekitToken: 'POST /api/livekit/token',
      livekitStatus: 'GET /api/livekit/status',
      livekitIngestStarted: 'POST /api/livekit/ingest-started',
      livekitVisionFrame: 'POST /api/livekit/vision-frame',
    },
    websocket: `ws://localhost:${PORT}`,
  });
});

// ── Start ──
async function start() {
  await initChroma();
  initV2VConnection();

  server.listen(PORT, () => {
    console.log('');
    console.log('  🌙  LIVING WORLDS — Bedtime Story Engine');
    console.log('  ────────────────────────────────────');
    console.log(`  HTTP:      http://localhost:${PORT}`);
    console.log(`  WebSocket: ws://localhost:${PORT}`);
    console.log('  Database:  connected');
    console.log(`  Gemini:    ${process.env.GEMINI_API_KEY ? 'configured' : 'required (set GEMINI_API_KEY)'}`);
    console.log(`  Vision:    ${process.env.GEMINI_API_KEY ? 'configured (camera analysis)' : 'requires GEMINI_API_KEY'}`);
    console.log(`  Speech:    ${process.env.GEMINI_API_KEY ? 'configured (speech-to-text)' : 'requires GEMINI_API_KEY'}`);
    console.log(`  NanoBanana:${process.env.NANOBANANA_API_KEY ? 'NanoBanana 2' : process.env.GOOGLE_CLOUD_PROJECT ? 'Imagen (Vertex)' : 'required (NANOBANANA_API_KEY or GOOGLE_CLOUD_PROJECT)'}`);
    console.log(`  Lyria:     ${process.env.GOOGLE_CLOUD_PROJECT ? 'Vertex Lyria 2' : 'required (GOOGLE_CLOUD_PROJECT)'}`);
    console.log(`  Lyria RT:  ${process.env.GEMINI_API_KEY ? 'Gemini API (bedtime story)' : 'use GEMINI_API_KEY for bedtime mode'}`);
    console.log(`  Chroma:    ${isChromaEnabled() ? 'connected (semantic memory)' : 'unavailable (optional)'}`);
    console.log(`  V2V:       ${isV2VConfigured() ? 'enabled (Overshoot)' : 'disabled (set V2V_SERVICE_URL)'}`);
    console.log(`  Veo:       ${isVeoConfigured() ? 'enabled (video generation)' : 'disabled (set VEO_ENABLED=true)'}`);
    console.log('');
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
