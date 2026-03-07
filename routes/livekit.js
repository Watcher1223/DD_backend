// ═══════════════════════════════════════════════
// LIVEKIT ROUTES — Token API for real-time video
// POST /api/livekit/token — JWT for room join (publisher or viewer)
// ═══════════════════════════════════════════════

import { Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { getActiveStorySession, applyCharacterInjectionToLyria } from './story.js';
import { processFrame } from '../workers/stage_vision_worker.js';
import { generateCharacterInjectionBeat } from '../ai/gemini.js';
import { generateSceneImage } from '../ai/nanobanana.js';
import { getReferenceFrames } from '../memory/reference_store.js';
import { queryStageIdentityByDescription, isReidentificationMatch, upsertStageIdentity } from '../memory/chroma.js';

const router = Router();

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const ROOM_PREFIX = process.env.LIVEKIT_ROOM_PREFIX || 'story';

function isLiveKitConfigured() {
  return !!(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
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
 * POST /api/livekit/vision-frame
 * Send a frame from the LiveKit stream (client captures from published track and POSTs every 500ms or so).
 * Server runs stage vision, updates session state, broadcasts stage_vision_tick; on new entrant runs character injection and Lyria update.
 * Body: { frame: string (base64), generateImage?: boolean }
 */
router.post('/livekit/vision-frame', async (req, res) => {
  const session = getActiveStorySession();
  if (!session) {
    return res.status(409).json({ error: 'No active story session', message: 'Call POST /api/story/start first.' });
  }
  const { frame, generateImage } = req.body || {};
  if (!frame || typeof frame !== 'string') {
    return res.status(400).json({ error: 'frame is required (base64 encoded image)' });
  }

  const broadcast = req.app.locals.broadcast;

  try {
    const result = await processFrame(frame, session, broadcast);

    let character_beat = null;
    let imageUrl = null;

    if (result.new_entrant && result.new_entrant_description) {
      const context = session.lastSetting || '';
      const matches = await queryStageIdentityByDescription(session.campaignId, result.new_entrant_description, 3);
      if (matches.length > 0 && isReidentificationMatch(matches[0].distance)) {
        const m = matches[0];
        character_beat = {
          narration: m.metadata?.narration || 'A familiar traveler returned to the camp.',
          scene_prompt: m.metadata?.scene_prompt || 'Gentle bedtime illustration of a friendly traveler, soft lighting, dreamy, watercolor style',
        };
      }
      if (!character_beat) {
        character_beat = await generateCharacterInjectionBeat(result.new_entrant_description, context);
        await upsertStageIdentity(session.campaignId, `judge_${result.people_count}`, result.new_entrant_description, {
          characterSkin: 'traveler',
          narration: character_beat.narration,
          scene_prompt: character_beat.scene_prompt,
        });
      }
      if (generateImage && character_beat.scene_prompt) {
        try {
          const lkRefs = getReferenceFrames(session.campaignId);
          const imgResult = await generateSceneImage(character_beat.scene_prompt, lkRefs, session.campaignId);
          if (imgResult?.imageUrl) imageUrl = imgResult.imageUrl;
        } catch (imgErr) {
          console.warn('[LIVEKIT] Character card image failed:', imgErr.message);
        }
      }
      if (broadcast && character_beat) {
        broadcast(
          JSON.stringify({
            type: 'character_injection',
            narration: character_beat.narration,
            scene_prompt: character_beat.scene_prompt,
            imageUrl: imageUrl || undefined,
            new_entrant_description: result.new_entrant_description,
          })
        );
      }
      await applyCharacterInjectionToLyria(session, character_beat);
      const v2vPrompt = `A hero, a magical doll, and ${result.new_entrant_description} in a ${session.userTheme || 'bedtime'} setting.`;
      if (broadcast) {
        broadcast(JSON.stringify({ type: 'v2v_prompt_updated', prompt: v2vPrompt }));
      }
    }

    res.json({
      people_count: result.people_count,
      new_entrant: result.new_entrant,
      character_beat: character_beat || undefined,
      imageUrl: imageUrl || undefined,
    });
  } catch (err) {
    console.error('[LIVEKIT] Vision-frame failed:', err.message);
    const status = err.message?.includes('required') || err.message?.includes('Gemini') ? 503 : 500;
    res.status(status).json({ error: 'Vision frame failed', details: err.message });
  }
});

export default router;
