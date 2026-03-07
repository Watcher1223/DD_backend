// ═══════════════════════════════════════════════
// CAMERA ROUTES — Webcam frame analysis endpoints
// Accepts camera frames, runs Gemini Vision for
// character analysis, and persists profiles.
// Supports local webcam and remote phone camera
// via pairing codes.
// ═══════════════════════════════════════════════

import { Router } from 'express';
import { analyzeCharacters } from '../vision/character_analysis.js';
import { resolveCampaignId } from './resolve_campaign.js';
import { createPairing, resolvePairing, pruneExpired } from '../utils/pairing.js';
import {
  upsertSessionProfile,
  getSessionProfiles,
} from '../db/index.js';

const router = Router();

/**
 * Run character analysis on a frame and persist the results.
 * Shared by the local and remote camera endpoints.
 * @returns {{ people, setting, stored, elapsed_ms }}
 */
async function analyzeAndStore(frame, campaignId) {
  const startTime = Date.now();
  const analysis = await analyzeCharacters(frame);

  const frameTs = Date.now();
  for (const person of analysis.people) {
    upsertSessionProfile(campaignId, person.label, person, frameTs);
  }

  return {
    people: analysis.people,
    setting: analysis.setting,
    stored: analysis.people.length,
    elapsed_ms: Date.now() - startTime,
  };
}

// ── POST /api/camera/analyze — Local webcam analysis ──

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
    const result = await analyzeAndStore(frame, campaignId);
    broadcastProfileUpdate(req, campaignId, result, 'local');
    res.json(result);
  } catch (err) {
    console.error('[CAMERA] Analysis error:', err);
    const status = err.message && (err.message.includes('required') || err.message.includes('failed')) ? 503 : 500;
    res.status(status).json({ error: 'Character analysis failed', details: err.message });
  }
});

// ── GET /api/camera/profiles — Retrieve stored profiles ──

router.get('/camera/profiles', (req, res) => {
  const campaignId = resolveCampaignId(req);
  if (campaignId === null) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const profiles = getSessionProfiles(campaignId);
  res.json({ profiles });
});

// ── POST /api/camera/pair — Generate a pairing code for phone camera ──

router.post('/camera/pair', (req, res) => {
  pruneExpired();
  const campaignId = resolveCampaignId(req);
  if (campaignId === null) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const { code, expiresAt } = createPairing(campaignId);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const phoneUrl = `${baseUrl}/phone-camera.html?code=${code}`;

  res.json({ code, phoneUrl, expiresAt });
});

// ── GET /api/camera/pair/:code — Validate a pairing code (phone calls this) ──

router.get('/camera/pair/:code', (req, res) => {
  const campaignId = resolvePairing(req.params.code);
  if (campaignId === null) {
    return res.status(404).json({ error: 'Invalid or expired pairing code' });
  }
  res.json({ valid: true, campaignId });
});

// ── POST /api/camera/remote/:code — Phone sends a frame via pairing code ──

router.post('/camera/remote/:code', async (req, res) => {
  const campaignId = resolvePairing(req.params.code);
  if (campaignId === null) {
    return res.status(404).json({ error: 'Invalid or expired pairing code' });
  }

  const { frame } = req.body;
  if (!frame) {
    return res.status(400).json({ error: 'frame is required (base64 encoded image)' });
  }

  try {
    const result = await analyzeAndStore(frame, campaignId);
    broadcastProfileUpdate(req, campaignId, result, 'phone');
    res.json(result);
  } catch (err) {
    console.error('[CAMERA REMOTE] Analysis error:', err);
    const status = err.message && (err.message.includes('required') || err.message.includes('failed')) ? 503 : 500;
    res.status(status).json({ error: 'Character analysis failed', details: err.message });
  }
});

/**
 * Broadcast a WebSocket event when profiles are updated, so the desktop client can refresh.
 */
function broadcastProfileUpdate(req, campaignId, result, source) {
  if (req.app.locals.broadcast) {
    req.app.locals.broadcast(JSON.stringify({
      type: 'profiles_updated',
      campaignId,
      source,
      people: result.people,
      setting: result.setting,
      stored: result.stored,
    }));
  }
}

export default router;
