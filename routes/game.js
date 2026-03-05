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

const router = Router();

// ── In-memory campaign state (world memory) ──
let campaign = {
  characters: [
    { name: 'Thorn', role: 'Shadow Ranger', description: 'A hooded figure with silver eyes' },
  ],
  locations: ['The Rusty Chalice Tavern'],
  events: [],
};

// ── POST /api/action — Main game loop endpoint ──
// This is the core pipeline: action → narration → image → music
router.post('/action', async (req, res) => {
  const startTime = Date.now();
  const { action, diceRoll, webcamFrame } = req.body;

  if (!action) {
    return res.status(400).json({ error: 'action is required' });
  }

  try {
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

    // Step 5: Update world memory
    const event = {
      action,
      diceRoll: resolvedDice,
      narration: storyBeat.narration,
      scene_prompt: storyBeat.scene_prompt,
      music_mood: storyBeat.music_mood,
      location: storyBeat.location || 'Unknown',
      timestamp: Date.now(),
    };
    campaign.events.push(event);

    // Update known locations
    if (storyBeat.location && !campaign.locations.includes(storyBeat.location)) {
      campaign.locations.push(storyBeat.location);
    }

    const elapsed = Date.now() - startTime;

    // Return everything the frontend needs
    const response = {
      narration: storyBeat.narration,
      diceRoll: resolvedDice,
      image: imageResult,
      music: musicResult,
      location: storyBeat.location,
      music_mood: storyBeat.music_mood,
      elapsed_ms: elapsed,
      event_number: campaign.events.length,
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
    res.status(500).json({ error: 'Story generation failed', details: err.message });
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
  res.json({
    characters: campaign.characters,
    locations: campaign.locations,
    eventCount: campaign.events.length,
    recentEvents: campaign.events.slice(-5),
  });
});

// ── POST /api/campaign/reset — Reset campaign ──
router.post('/campaign/reset', (req, res) => {
  campaign = {
    characters: [
      { name: 'Thorn', role: 'Shadow Ranger', description: 'A hooded figure with silver eyes' },
    ],
    locations: ['The Rusty Chalice Tavern'],
    events: [],
  };
  res.json({ ok: true, message: 'Campaign reset' });
});

// ── GET /api/moods — List available music moods ──
router.get('/moods', (req, res) => {
  res.json({ moods: getAvailableMoods() });
});

// ── GET /api/health — Health check ──
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'living-worlds',
    campaign_events: campaign.events.length,
    has_gemini: !!process.env.GEMINI_API_KEY,
    has_nanobanana: !!process.env.NANOBANANA_API_KEY,
    has_lyria: !!process.env.LYRIA_API_KEY,
  });
});

export default router;
