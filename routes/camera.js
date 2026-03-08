// ═══════════════════════════════════════════════
// CAMERA ROUTES — Unified webcam frame analysis
// Accepts camera frames, runs Gemini Vision for
// character analysis, persists profiles, and
// performs stage-vision new-entrant detection +
// character injection when a story session is active.
// Supports local webcam and remote phone camera
// via pairing codes.
// ═══════════════════════════════════════════════

import { Router } from 'express';
import sharp from 'sharp';
import { analyzeCharacters } from '../vision/character_analysis.js';
import { resolveCampaignId } from './resolve_campaign.js';
import { createPairing, resolvePairing, pruneExpired } from '../utils/pairing.js';
import { upsertAppearanceMemory, queryStageIdentityByDescription, isReidentificationMatch, upsertStageIdentity } from '../memory/chroma.js';
import { addReferenceFrame, setCanonicalDescription, getReferenceFrames } from '../memory/reference_store.js';
import { parseFrame } from '../utils/media.js';
import { processAnalyzedFrame } from '../workers/stage_vision_worker.js';
import { getActiveStorySession, applyCharacterInjectionToLyria } from './story.js';
import { generateCharacterInjectionBeat } from '../ai/gemini.js';
import { generateSceneImage } from '../ai/nanobanana.js';
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
  if (!frame || isEmptyFrame(frame)) {
    return res.status(202).json({ ready: false, message: 'Camera not ready yet — waiting for video stream' });
  }

  try {
    const result = await analyzeAndStore(frame, campaignId);
    broadcastProfileUpdate(req, campaignId, result, 'local');

    const stageInjection = await runStageVisionIfActive(
      result, campaignId, req.app.locals.broadcast, { generateImage: req.body.generateImage },
    );

    res.json({
      ...result,
      character_beat: stageInjection?.character_beat || undefined,
      imageUrl: stageInjection?.imageUrl || undefined,
    });
  } catch (err) {
    if (isEmptyFrameError(err)) {
      return res.status(202).json({ ready: false, message: 'Camera not ready yet — waiting for video stream' });
    }
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
  if (!frame || isEmptyFrame(frame)) {
    return res.status(202).json({ ready: false, message: 'Camera not ready yet — waiting for video stream' });
  }

  try {
    const result = await analyzeAndStore(frame, campaignId);
    broadcastProfileUpdate(req, campaignId, result, 'phone');

    const stageInjection = await runStageVisionIfActive(
      result, campaignId, req.app.locals.broadcast, { generateImage: req.body.generateImage },
    );

    res.json({
      ...result,
      character_beat: stageInjection?.character_beat || undefined,
      imageUrl: stageInjection?.imageUrl || undefined,
    });
  } catch (err) {
    if (isEmptyFrameError(err)) {
      return res.status(202).json({ ready: false, message: 'Camera not ready yet — waiting for video stream' });
    }
    console.error('[CAMERA REMOTE] Analysis error:', err);
    const status = err.message && (err.message.includes('required') || err.message.includes('failed')) ? 503 : 500;
    res.status(status).json({ error: 'Character analysis failed', details: err.message });
  }
});

/**
 * If a story session is active, run stage-vision new-entrant detection using the
 * already-fetched analysis results (no second Gemini call). On new entrant, trigger
 * character injection beat, optional image generation, and Lyria update.
 * @param {{ people: Array, setting?: string }} analysis - Pre-computed Gemini Vision result
 * @param {number} campaignId
 * @param {(msg: string) => void} broadcast
 * @param {{ generateImage?: boolean }} [opts]
 * @returns {Promise<{ character_beat?: object, imageUrl?: string } | null>}
 */
async function runStageVisionIfActive(analysis, campaignId, broadcast, opts = {}) {
  const session = getActiveStorySession();
  if (!session || String(session.campaignId) !== String(campaignId)) return null;

  const stageResult = processAnalyzedFrame(analysis, session, broadcast);
  if (!stageResult.new_entrant || !stageResult.new_entrant_description) return null;

  return handleNewEntrant(session, stageResult, campaignId, broadcast, opts.generateImage);
}

/**
 * Handle a newly detected entrant: re-id check, character injection beat,
 * optional image generation, WebSocket broadcast, and Lyria update.
 */
async function handleNewEntrant(session, stageResult, campaignId, broadcast, generateImage) {
  let character_beat = null;
  let imageUrl = null;
  const desc = stageResult.new_entrant_description;
  const context = session.lastSetting || '';

  const matches = await queryStageIdentityByDescription(campaignId, desc, 3);
  if (matches.length > 0 && isReidentificationMatch(matches[0].distance)) {
    const m = matches[0];
    character_beat = {
      narration: m.metadata?.narration || 'A familiar traveler returned to the camp.',
      scene_prompt: m.metadata?.scene_prompt || 'Gentle bedtime illustration of a friendly traveler, soft lighting, dreamy, watercolor style',
    };
  }

  if (!character_beat) {
    character_beat = await generateCharacterInjectionBeat(desc, context);
    await upsertStageIdentity(campaignId, `judge_${stageResult.people_count}`, desc, {
      characterSkin: 'traveler',
      narration: character_beat.narration,
      scene_prompt: character_beat.scene_prompt,
    });
  }

  if (generateImage && character_beat.scene_prompt) {
    try {
      const refs = getReferenceFrames(campaignId);
      const imgResult = await generateSceneImage(character_beat.scene_prompt, refs, campaignId);
      if (imgResult?.imageUrl) imageUrl = imgResult.imageUrl;
    } catch (imgErr) {
      console.warn('[CAMERA] Character card image failed:', imgErr.message);
    }
  }

  if (broadcast && character_beat) {
    broadcast(JSON.stringify({
      type: 'character_injection',
      narration: character_beat.narration,
      scene_prompt: character_beat.scene_prompt,
      imageUrl: imageUrl || undefined,
      new_entrant_description: desc,
    }));
  }

  await applyCharacterInjectionToLyria(session, character_beat);

  if (!session.stageCharacters) session.stageCharacters = [];
  session.stageCharacters.push({
    description: desc,
    narration: character_beat.narration,
    scene_prompt: character_beat.scene_prompt,
  });

  const v2vPrompt = `A hero, a magical doll, and ${desc} in a ${session.userTheme || 'bedtime'} setting.`;
  if (broadcast) {
    broadcast(JSON.stringify({ type: 'v2v_prompt_updated', prompt: v2vPrompt }));
  }

  return { character_beat, imageUrl };
}

/**
 * Check if a raw frame string is obviously empty (camera not producing pixels yet).
 * @param {string} frame
 * @returns {boolean}
 */
function isEmptyFrame(frame) {
  return frame === 'data:,' || frame === 'data:;base64,' || frame.length < 200;
}

/**
 * Check if an error was caused by an empty/too-small frame.
 * @param {Error} err
 * @returns {boolean}
 */
function isEmptyFrameError(err) {
  return err.message?.includes('Empty frame') || err.message?.includes('too small');
}

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
