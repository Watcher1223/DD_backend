// ═══════════════════════════════════════════════
// GAME ROUTES — Express API endpoints
// Handles player actions, dice detection, and
// orchestrates the AI pipeline.
// ═══════════════════════════════════════════════

import { Router } from 'express';
import { generateStoryBeat } from '../ai/gemini.js';
import { generateSceneImage } from '../ai/nanobanana.js';
import { getMusicForMood, getAvailableMoods } from '../ai/lyria.js';
import { detectDiceRoll } from '../vision/dice_detection.js';
import {
  getCampaign,
  appendEvent,
  addLocation,
  getOrCreateDefaultCampaign,
  resetCampaign,
  getEventCount,
  campaignExists,
  listCampaigns,
  createCampaign,
} from '../db/index.js';

const router = Router();

function resolveCampaignId(req) {
  const id = req.body?.campaignId ?? req.query?.campaignId;
  if (id != null) {
    const num = Number(id);
    if (Number.isNaN(num) || !campaignExists(num)) {
      return null;
    }
    return num;
  }
  return getOrCreateDefaultCampaign();
}

// ── POST /api/action — Main game loop endpoint ──
// This is the core pipeline: action → narration → image → music
router.post('/action', async (req, res) => {
  const startTime = Date.now();
  const campaignId = resolveCampaignId(req);
  if (campaignId === null) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const { action, diceRoll, webcamFrame } = req.body;

  if (!action) {
    return res.status(400).json({ error: 'action is required' });
  }

  try {
    const campaign = getCampaign(campaignId);

    // Step 1: Detect dice if webcam frame provided
    let resolvedDice = diceRoll || null;
    if (webcamFrame && !diceRoll) {
      const detection = await detectDiceRoll(webcamFrame);
      if (detection.detected) {
        resolvedDice = detection.value;
      }
    }

    // Step 2: Generate story beat with Gemini (includes narration + prompts)
    const storyBeat = await generateStoryBeat(action, resolvedDice, campaign);

    // Step 3 & 4: Generate image and music IN PARALLEL for speed
    const [imageResult, musicResult] = await Promise.all([
      generateSceneImage(storyBeat.scene_prompt),
      getMusicForMood(storyBeat.music_mood),
    ]);

    // Step 5: Update world memory in DB
    const event = {
      action,
      diceRoll: resolvedDice,
      narration: storyBeat.narration,
      scene_prompt: storyBeat.scene_prompt,
      music_mood: storyBeat.music_mood,
      location: storyBeat.location || 'Unknown',
      timestamp: Date.now(),
    };
    appendEvent(campaignId, event);
    addLocation(campaignId, storyBeat.location);

    const eventNumber = getEventCount(campaignId);
    const elapsed = Date.now() - startTime;

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const musicPayload = { ...musicResult };
    if (musicResult.audioUrl && musicResult.audioUrl.startsWith('http')) {
      musicPayload.audioUrl = `${baseUrl}/api/audio?url=${encodeURIComponent(musicResult.audioUrl)}`;
    } else if (musicResult.source === 'lyria' && !musicResult.audioUrl) {
      musicPayload.audioUrl = `${baseUrl}/api/music/generate?mood=${encodeURIComponent(musicResult.mood)}`;
    }
    const narrationAudioUrl = `${baseUrl}/api/tts?text=${encodeURIComponent(storyBeat.narration)}`;

    // Return everything the frontend needs
    const response = {
      narration: storyBeat.narration,
      narrationAudioUrl,
      diceRoll: resolvedDice,
      image: imageResult,
      music: musicPayload,
      location: storyBeat.location,
      music_mood: storyBeat.music_mood,
      elapsed_ms: elapsed,
      event_number: eventNumber,
    };

    // Also broadcast to WebSocket clients
    if (req.app.locals.broadcast) {
      req.app.locals.broadcast(JSON.stringify({
        type: 'story_update',
        ...response,
      }));
    }

    res.json(response);

  } catch (err) {
    console.error('[GAME] Pipeline error:', err);
    const status = err.message && err.message.includes('REAL_DATA_ONLY') ? 503 : 500;
    res.status(status).json({ error: 'Story generation failed', details: err.message });
  }
});

// ── POST /api/dice — Standalone dice detection ──
router.post('/dice', async (req, res) => {
  const { webcamFrame } = req.body;

  if (!webcamFrame) {
    // No frame — simulate a roll
    const roll = Math.floor(Math.random() * 20) + 1;
    return res.json({ detected: true, value: roll, simulated: true });
  }

  const result = await detectDiceRoll(webcamFrame);
  res.json(result);
});

// ── GET /api/campaign — Get current campaign state ──
router.get('/campaign', (req, res) => {
  const campaignId = resolveCampaignId(req);
  if (campaignId === null) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  const campaign = getCampaign(campaignId);
  res.json({
    characters: campaign.characters,
    locations: campaign.locations,
    eventCount: campaign.events.length,
    recentEvents: campaign.events.slice(-5),
  });
});

// ── POST /api/campaign/reset — Reset campaign ──
router.post('/campaign/reset', (req, res) => {
  const campaignId = resolveCampaignId(req);
  if (campaignId === null) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  resetCampaign(campaignId);
  res.json({ ok: true, message: 'Campaign reset' });
});

// ── GET /api/campaigns — List all campaigns ──
router.get('/campaigns', (req, res) => {
  res.json({ campaigns: listCampaigns() });
});

// ── POST /api/campaigns — Create a new campaign ──
router.post('/campaigns', (req, res) => {
  const name = req.body?.name;
  const id = createCampaign(name);
  res.status(201).json({ id, name: name || 'Unnamed campaign' });
});

// ── GET /api/moods — List available music moods ──
router.get('/moods', (req, res) => {
  res.json({ moods: getAvailableMoods() });
});

// ── GET /api/health — Health check ──
router.get('/health', (req, res) => {
  const defaultId = getOrCreateDefaultCampaign();
  res.json({
    status: 'ok',
    service: 'living-worlds',
    campaign_events: getEventCount(defaultId),
    has_gemini: !!process.env.GEMINI_API_KEY,
    has_nanobanana: !!(process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_AI_PROJECT || process.env.NANOBANANA_API_KEY),
    has_lyria: !!(process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_AI_PROJECT || process.env.LYRIA_API_KEY),
  });
});

export default router;
