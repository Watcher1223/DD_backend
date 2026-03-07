// ═══════════════════════════════════════════════
// CAMERA ROUTES — Webcam frame analysis endpoints
// Accepts camera frames, runs Gemini Vision for
// character analysis, and persists profiles.
// ═══════════════════════════════════════════════

import { Router } from 'express';
import { analyzeCharacters } from '../vision/character_analysis.js';
import {
  upsertSessionProfile,
  getSessionProfiles,
  getOrCreateDefaultCampaign,
  campaignExists,
} from '../db/index.js';

const router = Router();

/**
 * Resolve campaignId from the request body or query, falling back to the default.
 * Returns null if the provided id doesn't exist.
 */
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
 * POST /api/camera/analyze
 * Accept a webcam frame, run Gemini Vision character analysis,
 * store the resulting profiles, and return them.
 *
 * Body: { frame: string (base64), campaignId?: number }
 * Response: { people: [...], setting: string, stored: number }
 */
router.post('/camera/analyze', async (req, res) => {
  const campaignId = resolveCampaignId(req);
  if (campaignId === null) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const { frame } = req.body;
  if (!frame) {
    return res.status(400).json({ error: 'frame is required (base64 encoded image)' });
  }

  try {
    const startTime = Date.now();
    const analysis = await analyzeCharacters(frame);

    const frameTs = Date.now();
    for (const person of analysis.people) {
      upsertSessionProfile(campaignId, person.label, person, frameTs);
    }

    res.json({
      people: analysis.people,
      setting: analysis.setting,
      stored: analysis.people.length,
      elapsed_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[CAMERA] Analysis error:', err);
    const status = err.message && (err.message.includes('required') || err.message.includes('failed')) ? 503 : 500;
    res.status(status).json({ error: 'Character analysis failed', details: err.message });
  }
});

/**
 * GET /api/camera/profiles
 * Return stored session profiles for a campaign.
 *
 * Query: campaignId? (defaults to default campaign)
 * Response: { profiles: [{ label, appearance, updated_at }] }
 */
router.get('/camera/profiles', (req, res) => {
  const campaignId = resolveCampaignId(req);
  if (campaignId === null) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const profiles = getSessionProfiles(campaignId);
  res.json({ profiles });
});

export default router;
