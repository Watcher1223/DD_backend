// ═══════════════════════════════════════════════
// LIVEKIT ROUTES — Token API for real-time video
// POST /api/livekit/token — JWT for room join (publisher or viewer)
//
// NOTE: POST /api/livekit/vision-frame is kept for backward compatibility
// but delegates to the unified camera analysis pipeline in routes/camera.js.
// New frontends should call POST /api/camera/analyze instead.
// ═══════════════════════════════════════════════

import { Router } from 'express';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { getActiveStorySession } from './story.js';

const router = Router();

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const ROOM_PREFIX = process.env.LIVEKIT_ROOM_PREFIX || 'story';

export function isLiveKitConfigured() {
  return !!(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
}

/** RoomServiceClient for creating/managing rooms. */
let roomService = null;
function getRoomService() {
  if (!roomService && isLiveKitConfigured()) {
    roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  }
  return roomService;
}

/**
 * Ensure a LiveKit room exists for a campaign. Creates it if needed.
 * Safe to call multiple times (idempotent).
 * @param {string|number} campaignId
 * @returns {Promise<string>} The room name
 */
export async function ensureLiveKitRoom(campaignId) {
  const roomName = `${ROOM_PREFIX}-${campaignId}`;
  const svc = getRoomService();
  if (!svc) return roomName;
  try {
    await svc.createRoom({ name: roomName, emptyTimeout: 300, maxParticipants: 10 });
    console.log(`[LIVEKIT] Room "${roomName}" ensured`);
  } catch (err) {
    // Room may already exist — that's fine
    if (!err.message?.includes('already exists')) {
      console.warn(`[LIVEKIT] Room create warning: ${err.message}`);
    }
  }
  return roomName;
}

/**
 * Generate a viewer token for a room (used by V2V pipeline / external displays).
 * @param {string} roomName
 * @param {string} [identityPrefix]
 * @returns {Promise<string>} JWT token
 */
export async function generateViewerToken(roomName, identityPrefix = 'viewer') {
  const identity = `${identityPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: false, canSubscribe: true });
  return at.toJwt();
}

/**
 * Get the LiveKit room name for the active session (if any).
 * @returns {{ roomName: string, url: string } | null}
 */
export function getActiveLiveKitRoom() {
  const session = getActiveStorySession();
  if (!session || !isLiveKitConfigured()) return null;
  return {
    roomName: `${ROOM_PREFIX}-${session.campaignId}`,
    url: LIVEKIT_URL,
  };
}

/**
 * POST /api/livekit/token
 * Body: { campaignId?: number | string, role: "publisher" | "viewer" }
 * Returns: { token, roomName, url } for client to join room and publish (camera) or subscribe (display).
 * Requires active story session when role is publisher; campaignId must match session or is inferred from session.
 */
router.post('/livekit/token', async (req, res) => {
  if (!isLiveKitConfigured()) {
    return res.status(503).json({
      error: 'LiveKit not configured',
      details: 'Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in .env',
    });
  }

  const session = getActiveStorySession();
  const bodyCampaignId = req.body?.campaignId != null ? String(req.body.campaignId) : null;
  const role = req.body?.role === 'viewer' ? 'viewer' : 'publisher';

  // Room name: story-{campaignId}
  let campaignId = bodyCampaignId || (session?.campaignId != null ? String(session.campaignId) : null);
  if (!campaignId) {
    return res.status(400).json({
      error: 'No campaign or session',
      details: 'Start a story session (POST /api/story/start) first, or send campaignId in body',
    });
  }

  // Publisher must have active session and campaignId must match
  if (role === 'publisher') {
    if (!session) {
      return res.status(409).json({
        error: 'No active story session',
        details: 'Call POST /api/story/start before requesting a publisher token',
      });
    }
    if (bodyCampaignId && String(session.campaignId) !== bodyCampaignId) {
      return res.status(403).json({
        error: 'Campaign mismatch',
        details: 'campaignId does not match the active story session',
      });
    }
    campaignId = String(session.campaignId);
  }

  const roomName = `${ROOM_PREFIX}-${campaignId}`;
  const identity = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  try {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: role === 'publisher',
      canSubscribe: true,
    });
    const token = await at.toJwt();

    res.json({
      token,
      roomName,
      url: LIVEKIT_URL,
      role,
    });
  } catch (err) {
    console.error('[LIVEKIT] Token error:', err);
    res.status(500).json({ error: 'Failed to create token', details: err.message });
  }
});

/**
 * GET /api/livekit/status
 * Returns whether LiveKit is configured (for health/UI).
 */
router.get('/livekit/status', (req, res) => {
  res.json({
    configured: isLiveKitConfigured(),
    url: LIVEKIT_URL ? true : false,
  });
});

/**
 * POST /api/livekit/ingest-started
 * Call after the client has published a video track to the room. Server broadcasts livekit_ingest_active so viewers know camera is live.
 * Body: { roomName: string }
 */
router.post('/livekit/ingest-started', (req, res) => {
  const session = getActiveStorySession();
  const roomName = req.body?.roomName;
  const prefix = process.env.LIVEKIT_ROOM_PREFIX || 'story';
  const expectedRoom = session ? `${prefix}-${session.campaignId}` : null;

  if (!roomName || typeof roomName !== 'string') {
    return res.status(400).json({ error: 'roomName is required' });
  }
  if (session && roomName !== expectedRoom) {
    return res.status(403).json({ error: 'roomName does not match active story session' });
  }

  const broadcast = req.app.locals.broadcast;
  if (broadcast) {
    broadcast(JSON.stringify({ type: 'livekit_ingest_active', roomName, hasVideo: true }));
    broadcast(JSON.stringify({ type: 'livekit_egress_active', roomName, trackName: 'camera' }));
  }
  res.json({ ok: true, roomName });
});

/**
 * GET /api/livekit/viewer-token
 * Returns a viewer token for the active story room (no body required).
 * External displays / phones can use this to watch the live story and V2V output.
 */
router.get('/livekit/viewer-token', async (req, res) => {
  if (!isLiveKitConfigured()) {
    return res.status(503).json({ error: 'LiveKit not configured' });
  }
  const session = getActiveStorySession();
  if (!session) {
    return res.status(409).json({ error: 'No active story session' });
  }
  const roomName = `${ROOM_PREFIX}-${session.campaignId}`;
  try {
    const token = await generateViewerToken(roomName, 'display');
    res.json({ token, roomName, url: LIVEKIT_URL, role: 'viewer' });
  } catch (err) {
    console.error('[LIVEKIT] Viewer token error:', err);
    res.status(500).json({ error: 'Failed to create viewer token', details: err.message });
  }
});

/**
 * POST /api/livekit/vision-frame (LEGACY — delegates to POST /api/camera/analyze)
 * Kept for backward compatibility. New clients should call /api/camera/analyze directly.
 * Rewrites the request to include campaignId from the active story session, then
 * forwards to the unified camera analysis endpoint which handles both profile
 * storage and stage-vision new-entrant detection in a single Gemini call.
 */
router.post('/livekit/vision-frame', (req, res, next) => {
  const session = getActiveStorySession();
  if (!session) {
    return res.status(409).json({ error: 'No active story session', message: 'Call POST /api/story/start first.' });
  }
  req.body = req.body || {};
  req.body.campaignId = session.campaignId;
  req.url = '/api/camera/analyze';
  req.app.handle(req, res, next);
});

export default router;
