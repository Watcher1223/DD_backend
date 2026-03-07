// ═══════════════════════════════════════════════
// CAMERA ROUTES — Webcam frame analysis endpoints
// Accepts camera frames, runs Gemini Vision for
// character analysis, and persists profiles.
// Supports local webcam and remote phone camera
// via pairing codes.
// ═══════════════════════════════════════════════

import { Router } from 'express';
import sharp from 'sharp';
import { analyzeCharacters } from '../vision/character_analysis.js';
import { resolveCampaignId } from './resolve_campaign.js';
import { createPairing, resolvePairing, pruneExpired } from '../utils/pairing.js';
import { upsertAppearanceMemory } from '../memory/chroma.js';
import { addReferenceFrame, setCanonicalDescription } from '../memory/reference_store.js';
import { parseFrame } from '../utils/media.js';
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
    console.log(`[CAMERA] Stored ${person.label}: hair=${person.hair}, clothing=${person.clothing}, features=${person.features}`);
    upsertSessionProfile(campaignId, person.label, person, frameTs);
    upsertAppearanceMemory(campaignId, person, analysis.setting).catch(() => {});
  }

  await storeReferenceFrame(frame, campaignId, analysis.people);

  return {
    people: analysis.people,
    setting: analysis.setting,
    stored: analysis.people.length,
    elapsed_ms: Date.now() - startTime,
  };
}

/**
 * Save the raw camera frame as a subject reference for Imagen Customization.
 * Crops to the detected face when a face_box is available so the face is
 * centered and occupies most of the image (per Google's reference image guidelines).
 */
async function storeReferenceFrame(frame, campaignId, people) {
  if (people.length === 0) return;
  try {
    const { data, mimeType } = parseFrame(frame);
    const primary = people[0];
    const desc = buildSubjectDescription(primary);
    const cropped = await cropToFace(data, mimeType, primary.face_box);
    addReferenceFrame(campaignId, cropped.data, cropped.mimeType, desc);
    setCanonicalDescription(campaignId, desc);
  } catch (err) {
    console.warn('[CAMERA] Failed to store reference frame:', err.message);
  }
}

/**
 * Crop a base64 image buffer around the detected face bounding box.
 * Adds padding so the face occupies roughly half the output image.
 * Falls back to the original frame if face_box is missing or cropping fails.
 * @param {string} base64Data - Raw base64 image data
 * @param {string} mimeType - Image MIME type
 * @param {{ x: number, y: number, width: number, height: number }} faceBox - Normalized 0-1 coordinates
 * @returns {Promise<{ data: string, mimeType: string }>}
 */
async function cropToFace(base64Data, mimeType, faceBox) {
  if (!faceBox || !faceBox.width || !faceBox.height) {
    return { data: base64Data, mimeType };
  }

  try {
    const buf = Buffer.from(base64Data, 'base64');
    const meta = await sharp(buf).metadata();
    const imgW = meta.width;
    const imgH = meta.height;

    const faceW = Math.round(faceBox.width * imgW);
    const faceH = Math.round(faceBox.height * imgH);
    const faceCx = Math.round((faceBox.x + faceBox.width / 2) * imgW);
    const faceCy = Math.round((faceBox.y + faceBox.height / 2) * imgH);

    const pad = 0.5;
    const cropW = Math.min(Math.round(faceW * (1 + pad * 2)), imgW);
    const cropH = Math.min(Math.round(faceH * (1 + pad * 2)), imgH);

    const left = Math.max(0, Math.min(faceCx - Math.round(cropW / 2), imgW - cropW));
    const top  = Math.max(0, Math.min(faceCy - Math.round(cropH / 2), imgH - cropH));

    const croppedBuf = await sharp(buf)
      .extract({ left, top, width: cropW, height: cropH })
      .jpeg({ quality: 90 })
      .toBuffer();

    console.log(`[CAMERA] Face-cropped reference: ${imgW}x${imgH} → ${cropW}x${cropH}`);
    return { data: croppedBuf.toString('base64'), mimeType: 'image/jpeg' };
  } catch (err) {
    console.warn('[CAMERA] Face crop failed, using full frame:', err.message);
    return { data: base64Data, mimeType };
  }
}

/**
 * Build a concise subject description from the camera analysis for Imagen's subjectDescription field.
 * @param {{ label?: string, hair?: string, clothing?: string, features?: string, age_range?: string }} person
 * @returns {string}
 */
function buildSubjectDescription(person) {
  const parts = [];
  if (person.character_description) {
    parts.push(person.character_description);
  } else {
    if (person.age_range) parts.push(person.age_range);
    if (person.skin_tone) parts.push(`${person.skin_tone} skin`);
    if (person.hair) parts.push(`${person.hair} hair`);
    if (person.features) parts.push(person.features);
  }
  if (person.clothing) parts.push(`wearing ${person.clothing}`);
  return parts.length > 0 ? parts.join(', ') : 'a person';
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
