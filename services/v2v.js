// ═══════════════════════════════════════════════
// V2V SERVICE — Video-to-Video transform via Overshoot WebSocket
// transformFrame(frame, prompt) → stylized frame
// Persistent WS connection with auto-reconnect.
// ═══════════════════════════════════════════════

import WebSocket from 'ws';

const V2V_SERVICE_URL = process.env.V2V_SERVICE_URL || '';
const V2V_FRAME_TIMEOUT_MS = 3000;
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;

let ws = null;
let connected = false;
let reconnectDelay = RECONNECT_DELAY_MS;
let reconnectTimer = null;
let framesProcessed = 0;
let totalLatencyMs = 0;

/** Pending request resolvers keyed by requestId */
const pendingRequests = new Map();

/**
 * Initialize persistent WebSocket connection to Overshoot V2V service.
 * Auto-reconnects on disconnect. Safe to call multiple times.
 */
export function initV2VConnection() {
  if (!V2V_SERVICE_URL) {
    console.log('[V2V] No V2V_SERVICE_URL configured — V2V disabled');
    return;
  }

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  console.log(`[V2V] Connecting to ${V2V_SERVICE_URL}...`);
  ws = new WebSocket(V2V_SERVICE_URL);

  ws.on('open', () => {
    connected = true;
    reconnectDelay = RECONNECT_DELAY_MS;
    console.log('[V2V] Connected to Overshoot');
  });

  ws.on('message', (data) => {
    try {
      const raw = typeof data === 'string' ? data : (Buffer.isBuffer(data) ? data.toString() : null);
      const msg = raw ? JSON.parse(raw) : null;
      if (msg?.requestId && pendingRequests.has(msg.requestId)) {
        const { resolve } = pendingRequests.get(msg.requestId);
        pendingRequests.delete(msg.requestId);
        if (msg.image) {
          // Overshoot returns stylized frame as base64
          resolve(Buffer.from(msg.image, 'base64'));
        } else if (msg.result) {
          // Some Overshoot modes return text result; pass through original frame
          resolve(null);
        } else {
          resolve(null);
        }
      }
    } catch (_) { /* ignore parse errors */ }
  });

  ws.on('close', () => {
    connected = false;
    ws = null;
    // Reject all pending requests
    for (const [id, { resolve }] of pendingRequests) {
      resolve(null);
      pendingRequests.delete(id);
    }
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.warn('[V2V] WebSocket error:', err.message);
    connected = false;
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  if (!V2V_SERVICE_URL) return;
  console.log(`[V2V] Reconnecting in ${reconnectDelay / 1000}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
    initV2VConnection();
  }, reconnectDelay);
}

/**
 * Transform a single frame with a scene prompt via Overshoot WS.
 * Falls back to returning the input frame on timeout or disconnection.
 * @param {Buffer|Uint8Array} frameBuffer - Raw frame (JPEG bytes or base64 string)
 * @param {string} prompt - Scene prompt for stylization
 * @returns {Promise<Buffer>} Transformed frame (or original on fallback)
 */
export async function transformFrame(frameBuffer, prompt) {
  if (!frameBuffer || frameBuffer.length === 0) {
    return Buffer.from([]);
  }

  const inputBuffer = Buffer.isBuffer(frameBuffer) ? frameBuffer : Buffer.from(frameBuffer);

  // If not connected, return input as fallback
  if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
    return inputBuffer;
  }

  const requestId = `v2v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const startTime = Date.now();

  // Convert frame to base64 for WS transport
  const imageBase64 = inputBuffer.toString('base64');

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve(inputBuffer); // Fallback on timeout
    }, V2V_FRAME_TIMEOUT_MS);

    pendingRequests.set(requestId, {
      resolve: (result) => {
        clearTimeout(timeout);
        const latency = Date.now() - startTime;
        framesProcessed++;
        totalLatencyMs += latency;
        if (result) {
          resolve(result);
        } else {
          resolve(inputBuffer); // Fallback
        }
      },
    });

    try {
      ws.send(JSON.stringify({
        type: 'analyze',
        image: imageBase64,
        prompt,
        requestId,
      }));
    } catch (err) {
      clearTimeout(timeout);
      pendingRequests.delete(requestId);
      resolve(inputBuffer);
    }
  });
}

/**
 * Whether a real V2V backend is configured and enabled.
 * @returns {boolean}
 */
export function isV2VConfigured() {
  return !!(V2V_SERVICE_URL || process.env.V2V_ENABLED === 'true');
}

/**
 * Get current V2V connection status and stats.
 * @returns {{ connected: boolean, framesProcessed: number, avgLatencyMs: number }}
 */
export function getV2VStatus() {
  return {
    connected,
    framesProcessed,
    avgLatencyMs: framesProcessed > 0 ? Math.round(totalLatencyMs / framesProcessed) : 0,
  };
}
