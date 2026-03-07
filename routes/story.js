// ═══════════════════════════════════════════════
// STORY ROUTES — Bedtime story mode: Lyria RealTime + theme updates
// POST /api/story/start, POST /api/music/update, POST /api/story/stop
// ═══════════════════════════════════════════════

import { Router } from 'express';
import { createLyriaRealtimeSession } from '../ai/lyria_realtime.js';
import { generateBedtimeStoryBeat } from '../ai/gemini.js';
import {
  generateMusicPrompts,
  shouldUpdatePrompts,
  markPromptsApplied,
  resetThrottle,
  DEFAULT_WEIGHTED_PROMPTS,
} from '../ai/music_engine.js';
import {
  getCampaign,
  getOrCreateDefaultCampaign,
  appendEvent,
  addLocation,
  getEventCount,
  campaignExists,
} from '../db/index.js';

const router = Router();

/** In-memory active bedtime story session: { handle } or null */
let activeStorySession = null;

/**
 * POST /api/story/start
 * Start a bedtime story session: wait for at least one subscriber, then open Lyria RealTime and start play.
 */
router.post('/story/start', async (req, res) => {
  if (activeStorySession) {
    return res.status(200).json({ ok: true, message: 'Session already active' });
  }

  const broadcastStoryAudio = req.app.locals.broadcastStoryAudio;
  const getStoryAudioSubscriberCount = req.app.locals.getStoryAudioSubscriberCount;
  if (!broadcastStoryAudio) {
    return res.status(500).json({ error: 'Story audio broadcast not configured' });
  }

  try {
    // Wait for at least one client to subscribe so we don't broadcast to nobody
    const deadline = Date.now() + 5000;
    while (getStoryAudioSubscriberCount() < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (getStoryAudioSubscriberCount() < 1) {
      console.warn('[STORY] Starting Lyria with no subscribers — client should send subscribe before calling /story/start');
    } else {
      console.log('[STORY] Subscriber(s) ready, starting Lyria RealTime');
    }

    const handle = await createLyriaRealtimeSession({
      onAudioChunk(buf) {
        if (!req.app.locals._lyriaChunkCount) req.app.locals._lyriaChunkCount = 0;
        req.app.locals._lyriaChunkCount++;
        if (req.app.locals._lyriaChunkCount <= 3 || req.app.locals._lyriaChunkCount % 20 === 0) {
          console.log('[STORY] Lyria audio chunk #' + req.app.locals._lyriaChunkCount + ', size=' + buf.length);
        }
        broadcastStoryAudio(buf);
      },
      onClose() {
        if (activeStorySession?.handle === handle) {
          activeStorySession = null;
          resetThrottle();
          req.app.locals.broadcastStoryAudioEnd?.();
        }
      },
      onError(err) {
        console.error('[STORY] Lyria RealTime error:', err);
      },
    });

    await handle.updatePrompts(DEFAULT_WEIGHTED_PROMPTS);
    handle.setMusicGenerationConfig({ bpm: 70, density: 0.5 });
    handle.play();

    activeStorySession = { handle };
    resetThrottle();
    req.app.locals._lyriaChunkCount = 0;

    res.json({ ok: true, message: 'Bedtime story session started' });
  } catch (err) {
    console.error('[STORY] Start failed:', err.message);
    res.status(503).json({
      error: 'Failed to start story session',
      details: err.message,
    });
  }
});

/**
 * POST /api/music/update
 * Body: { theme?, genre?, mood?, intensity?, emotion? }
 * Updates Lyria RealTime prompts when session is active (with throttling).
 */
router.post('/music/update', (req, res) => {
  if (!activeStorySession) {
    return res.status(409).json({
      error: 'No active story session',
      message: 'Call POST /api/story/start first.',
    });
  }

  const scene = {
    theme: req.body?.theme ?? 'bedtime',
    genre: req.body?.genre,
    mood: req.body?.mood ?? 'calm',
    intensity: req.body?.intensity,
    emotion: req.body?.emotion ?? 'neutral',
  };

  const { weightedPrompts, theme, mood, intensity } = generateMusicPrompts(scene);

  if (!shouldUpdatePrompts({ theme, mood, intensity })) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'throttled' });
  }

  activeStorySession.handle
    .updatePrompts(weightedPrompts)
    .then(() => {
      markPromptsApplied({ theme, mood, intensity });
      res.json({ ok: true, updated: true });
    })
    .catch((err) => {
      console.error('[STORY] Music update failed:', err.message);
      res.status(503).json({ error: 'Failed to update music prompts', details: err.message });
    });
});

/**
 * POST /api/story/stop
 * End the bedtime story session and close Lyria RealTime.
 */
router.post('/story/stop', (req, res) => {
  if (!activeStorySession) {
    return res.status(200).json({ ok: true, message: 'No active session' });
  }

  try {
    activeStorySession.handle.close();
    activeStorySession = null;
    resetThrottle();
    res.json({ ok: true, message: 'Story session stopped' });
  } catch (err) {
    console.error('[STORY] Stop failed:', err.message);
    activeStorySession = null;
    resetThrottle();
    res.status(500).json({ error: 'Failed to stop session', details: err.message });
  }
});

/**
 * GET /api/story/status
 * Return whether a story session is active (for frontend).
 */
router.get('/story/status', (req, res) => {
  res.json({ active: !!activeStorySession });
});

/**
 * GET /api/story/debug
 * Return chunk count from Lyria (for debugging no-audio issues).
 */
router.get('/story/debug', (req, res) => {
  const count = req.app.locals._lyriaChunkCount ?? 0;
  res.json({ lyriaChunksReceived: count, sessionActive: !!activeStorySession });
});

function resolveCampaignId(req) {
  const id = req.body?.campaignId ?? req.query?.campaignId;
  if (id != null) {
    const num = Number(id);
    if (Number.isNaN(num) || !campaignExists(num)) return null;
    return num;
  }
  return getOrCreateDefaultCampaign();
}

/**
 * POST /api/story/beat
 * Bedtime story beat: Gemini generates narration + theme; optionally updates music and persists.
 * Body: { action, campaignId? }
 */
router.post('/story/beat', async (req, res) => {
  const campaignId = resolveCampaignId(req);
  if (campaignId === null) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  const action = req.body?.action;
  if (!action || typeof action !== 'string') {
    return res.status(400).json({ error: 'action is required' });
  }

  try {
    const campaign = getCampaign(campaignId);
    const beat = await generateBedtimeStoryBeat(action, campaign);

    const event = {
      action,
      diceRoll: null,
      narration: beat.narration,
      scene_prompt: beat.scene_prompt,
      music_mood: beat.theme || beat.mood || 'calm',
      location: beat.location || 'Unknown',
      timestamp: Date.now(),
    };
    appendEvent(campaignId, event);
    if (beat.location) addLocation(campaignId, beat.location);

    if (activeStorySession) {
      const scene = {
        theme: beat.theme,
        genre: beat.genre,
        mood: beat.mood,
        intensity: beat.intensity,
        emotion: beat.emotion,
      };
      const { weightedPrompts, theme, mood, intensity } = generateMusicPrompts(scene);
      if (shouldUpdatePrompts({ theme, mood, intensity })) {
        await activeStorySession.handle.updatePrompts(weightedPrompts);
        markPromptsApplied({ theme, mood, intensity });
      }
    }

    const eventNumber = getEventCount(campaignId);
    res.json({
      narration: beat.narration,
      scene_prompt: beat.scene_prompt,
      theme: beat.theme,
      mood: beat.mood,
      intensity: beat.intensity,
      emotion: beat.emotion,
      location: beat.location,
      event_number: eventNumber,
    });
  } catch (err) {
    console.error('[STORY] Beat failed:', err.message);
    const status = err.message?.includes('required') || err.message?.includes('failed') ? 503 : 500;
    res.status(status).json({ error: 'Story beat failed', details: err.message });
  }
});

export default router;
