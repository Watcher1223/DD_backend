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
import { initDb } from './db/index.js';

const PORT = parseInt(process.env.PORT || '4300', 10);

// ── Database ──
initDb();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Large limit for webcam frames

// Static files (test page)
app.use(express.static('public'));

// ── WebSocket setup ──
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[WS] Client connected (${wsClients.size} total)`);

  ws.on('close', () => {
    wsClients.delete(ws);
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

// ── Routes ──
app.use('/api', audioRoutes);
app.use('/api', gameRoutes);

// ── Root ──
app.get('/', (req, res) => {
  res.json({
    name: 'Living Worlds — AI Dungeon Master',
    version: '1.0.0',
    testAudio: 'GET /test-audio.html to verify narration + music playback',
    endpoints: {
      action: 'POST /api/action',
      dice: 'POST /api/dice',
      campaign: 'GET /api/campaign',
      campaigns: 'GET /api/campaigns, POST /api/campaigns',
      reset: 'POST /api/campaign/reset',
      moods: 'GET /api/moods',
      health: 'GET /api/health',
      audio: 'GET /api/audio?url=... (music proxy)',
      tts: 'GET /api/tts?text=... (narration speech)',
      musicGenerate: 'GET /api/music/generate?mood=... (Lyria 2)',
    },
    websocket: `ws://localhost:${PORT}`,
  });
});

// ── Start ──
server.listen(PORT, () => {
  console.log('');
  console.log('  ⚔️  LIVING WORLDS — AI Dungeon Master');
  console.log('  ────────────────────────────────────');
  console.log(`  HTTP:      http://localhost:${PORT}`);
  console.log(`  WebSocket: ws://localhost:${PORT}`);
  console.log('  Database:  connected');
  console.log(`  Gemini:    ${process.env.GEMINI_API_KEY ? 'configured' : 'MOCK MODE'}`);
  console.log(`  NanoBanana:${process.env.NANOBANANA_API_KEY ? 'NanoBanana 2 (hackathon)' : process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_AI_PROJECT ? 'Imagen (Vertex)' : ' MOCK MODE (pollinations.ai)'}`);
  console.log(`  Lyria:     ${process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_AI_PROJECT ? 'Vertex Lyria 2' : process.env.LYRIA_API_KEY ? 'configured' : 'MOCK MODE (preset tracks)'}`);
  if (process.env.REAL_DATA_ONLY === '1' || process.env.REAL_DATA_ONLY === 'true') {
    console.log('  REAL_DATA_ONLY: enabled (no mocks/placeholders)');
  }
  console.log('');
});
