// ═══════════════════════════════════════════════
// SCENE IMAGE — Imagen 3 Customization (personalized),
// NanoBanana 2, or Imagen 3 Fast (text-only fallback).
//
// Priority when reference frames exist:
//   1. Imagen 3 Customization (preserves user likeness)
//   2. NanoBanana (text-only)
//   3. Imagen 3 Fast (text-only)
//
// Without reference frames:
//   1. NanoBanana (text-only)
//   2. Imagen 3 Fast (text-only)
// ═══════════════════════════════════════════════

import { GoogleAuth } from 'google-auth-library';
import { getCanonicalDescription } from '../memory/reference_store.js';

const NANOBANANA_API_KEY = process.env.NANOBANANA_API_KEY;
const GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_AI_PROJECT;
const VERTEX_LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';

const IMAGEN_MODEL = process.env.IMAGEN_MODEL || 'imagen-3.0-fast-generate-001';
const IMAGEN_CUSTOM_MODEL = 'imagen-3.0-capability-001';

let cachedAuth = null;

/**
 * Get or create a cached GoogleAuth client for Vertex AI calls.
 * Reused across both Imagen Fast and Customization to avoid redundant auth setup.
 * @returns {Promise<string>} Bearer access token
 */
async function getVertexToken() {
  if (!cachedAuth) {
    cachedAuth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }
  const client = await cachedAuth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('No access token from Google Auth');
  return token.token;
}

/**
 * Whether Vertex AI Imagen is configured (Google Cloud project set).
 */
export function isVertexImagenConfigured() {
  return !!GOOGLE_CLOUD_PROJECT;
}

/**
 * Generate a scene image using Vertex AI Imagen.
 * @param {string} scenePrompt - Visual description of the scene
 * @returns {Promise<{ imageUrl: string, source: string }|null>}
 */
async function generateWithImagen(scenePrompt) {
  if (!GOOGLE_CLOUD_PROJECT) return null;
  try {
    const bearerToken = await getVertexToken();

    const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${IMAGEN_MODEL}:predict`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        instances: [{ prompt: scenePrompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '16:9',
        },
      }),
    });

    return parseImagenResponse(res, 'IMAGEN');
  } catch (err) {
    console.error('[IMAGEN] Generation error:', err.message);
    return null;
  }
}

// ── Subject Customization (Imagen 3 Capability) ──

/**
 * Generate a personalized scene image using Imagen 3 Subject Customization.
 * Sends up to 4 reference photos as REFERENCE_TYPE_SUBJECT so the generated
 * image preserves the user's actual likeness.
 * @param {string} scenePrompt - Scene description from Gemini
 * @param {Array<{ data: string, mimeType: string, subjectDescription: string }>} referenceFrames
 * @param {number} [campaignId] - Campaign ID for canonical description lookup
 * @returns {Promise<{ imageUrl: string, source: string }|null>}
 */
async function generateWithSubjectCustomization(scenePrompt, referenceFrames, campaignId) {
  if (!GOOGLE_CLOUD_PROJECT || referenceFrames.length === 0) return null;
  try {
    const bearerToken = await getVertexToken();

    const canonical = campaignId != null ? getCanonicalDescription(campaignId) : undefined;
    const subjectDesc = canonical || pickRichestDescription(referenceFrames);
    const customPrompt = buildCustomizationPrompt(scenePrompt, subjectDesc);

    const referenceImages = referenceFrames.map((frame) => ({
      referenceType: 'REFERENCE_TYPE_SUBJECT',
      referenceId: 1,
      referenceImage: { bytesBase64Encoded: frame.data },
      subjectImageConfig: {
        subjectDescription: subjectDesc,
        subjectType: 'SUBJECT_TYPE_PERSON',
      },
    }));

    referenceImages.push({
      referenceType: 'REFERENCE_TYPE_CONTROL',
      referenceId: 2,
      referenceImage: { bytesBase64Encoded: referenceFrames[0].data },
      controlImageConfig: {
        controlType: 'CONTROL_TYPE_FACE_MESH',
        enableControlImageComputation: true,
      },
    });

    const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${IMAGEN_CUSTOM_MODEL}:predict`;

    console.log(`[IMAGEN_CUSTOM] Generating with ${referenceFrames.length} subject ref(s) + face mesh, subject: "${subjectDesc}"`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        instances: [{
          prompt: customPrompt,
          referenceImages,
        }],
        parameters: {
          sampleCount: 4,
          aspectRatio: '16:9',
          personGeneration: 'allow_all',
          negativePrompt: 'generic face, different person, wrong face, multiple faces, blurry face, disfigured, low quality, bad anatomy',
        },
      }),
    });

    return parseImagenResponse(res, 'IMAGEN_CUSTOM');
  } catch (err) {
    console.error('[IMAGEN_CUSTOM] Generation error:', err.message);
    return null;
  }
}

/**
 * Parse a Vertex AI Imagen predict response into { imageUrl, source } or null.
 * Shared by both Imagen Fast and Customization to avoid duplicated parsing logic.
 * @param {Response} res - fetch Response object
 * @param {string} tag - Log prefix (e.g. 'IMAGEN' or 'IMAGEN_CUSTOM')
 * @returns {Promise<{ imageUrl: string, source: string }|null>}
 */
async function parseImagenResponse(res, tag) {
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[${tag}] Vertex predict error:`, res.status, errText);
    return null;
  }

  const data = await res.json();
  const predictions = data.predictions;
  if (!predictions || !predictions.length) {
    console.error(`[${tag}] No predictions in response`);
    return null;
  }

  console.log(`[${tag}] Received ${predictions.length} prediction(s)`);

  const first = predictions[0];
  const b64 = first.bytesBase64Encoded ?? first.bytesBase64encoded;
  const mimeType = first.mimeType || 'image/png';
  if (!b64) {
    console.error(`[${tag}] No bytesBase64Encoded in prediction`);
    return null;
  }

  const source = tag === 'IMAGEN_CUSTOM' ? 'imagen_custom' : 'imagen';
  const imageUrl = `data:${mimeType};base64,${b64}`;
  return { imageUrl, source };
}

/**
 * Strip heavy artistic stylization tokens from a scene prompt so they don't
 * fight Imagen's face preservation during Subject Customization.
 * Keeps the scene content intact while softening style overrides.
 * @param {string} scenePrompt
 * @returns {string}
 */
function cleanScenePromptForCustomization(scenePrompt) {
  return scenePrompt
    .replace(/watercolor\s+style/gi, '')
    .replace(/oil\s+painting\s+style/gi, '')
    .replace(/storybook\s+illustration\s+style/gi, 'illustration style')
    .replace(/fantasy\s+illustration\s+style/gi, 'illustration style')
    .replace(/cartoon\s+style/gi, '')
    .replace(/anime\s+style/gi, '')
    .replace(/painted\s+style/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Build the prompt for Imagen 3 Customization following Google's recommended
 * template for person + face mesh references.
 * @param {string} scenePrompt - Original scene prompt from Gemini (already character-forward)
 * @param {string} subjectDesc - Short description of the person
 * @returns {string}
 */
function buildCustomizationPrompt(scenePrompt, subjectDesc) {
  const cleaned = cleanScenePromptForCustomization(scenePrompt);
  return `A portrait of ${subjectDesc} [1] with the face structure from [2]: ${cleaned}. Preserve exact facial features, skin tone, and face shape of ${subjectDesc} [1]. Natural human eyes, high quality, 4k, masterpiece, super details, skin texture, soft realistic lighting, vibrant colors.`;
}

/**
 * Pick the longest (richest) subject description across all reference frames.
 * Later frames may capture better angles or lighting, producing more detail.
 * @param {Array<{ subjectDescription: string }>} frames
 * @returns {string}
 */
function pickRichestDescription(frames) {
  let best = frames[0].subjectDescription || 'a person';
  for (const f of frames) {
    if (f.subjectDescription && f.subjectDescription.length > best.length) {
      best = f.subjectDescription;
    }
  }
  return best;
}

// ── Public API ──────────────────────────────────

/**
 * Generate a scene image from a text prompt, optionally personalized with reference photos.
 * Priority with reference frames: Imagen Customization → NanoBanana → Imagen Fast.
 * Priority without reference frames: NanoBanana → Imagen Fast.
 * @param {string} scenePrompt - Visual description of the scene
 * @param {Array<{ data: string, mimeType: string, subjectDescription: string }>} [referenceFrames] - Camera reference photos
 * @param {number} [campaignId] - Campaign ID for canonical description lookup
 * @returns {Promise<{ imageUrl: string, source: string }>}
 */
export async function generateSceneImage(scenePrompt, referenceFrames = [], campaignId) {
  // ── Imagen 3 Customization (personalized, if reference frames available) ──
  if (referenceFrames.length > 0) {
    const customResult = await generateWithSubjectCustomization(scenePrompt, referenceFrames, campaignId);
    if (customResult) return customResult;

    console.warn('[SCENE] Customization attempt 1 failed, retrying once');
    const retryResult = await generateWithSubjectCustomization(scenePrompt, referenceFrames, campaignId);
    if (retryResult) return retryResult;

    console.warn('[SCENE] Customization failed after retry, falling back to text-only');
  }

  // ── NanoBanana 2 (YC x DeepMind hackathon; docs: nananobanana.com API v1) ──
  if (NANOBANANA_API_KEY && NANOBANANA_API_KEY !== 'your_nanobanana_api_key_here') {
    try {
      const res = await fetch('https://www.nananobanana.com/api/v1/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${NANOBANANA_API_KEY}`,
        },
        body: JSON.stringify({
          prompt: scenePrompt,
          selectedModel: 'nano-banana',
          aspectRatio: '16:9',
          mode: 'sync',
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error('[NANOBANANA] API error', res.status, errText);
      } else {
        const data = await res.json();
        const url = data.data?.outputImageUrls?.[0] ?? data.outputImageUrls?.[0] ?? data.outputImageUrl ?? data.image_url;
        if (url) {
          return { imageUrl: url, source: 'nanobanana' };
        }
      }
    } catch (err) {
      console.error('[NANOBANANA] API error, falling back:', err.message);
    }
  }

  // ── Vertex AI Imagen Fast (text-only fallback) ──
  const imagenResult = await generateWithImagen(scenePrompt);
  if (imagenResult) {
    return imagenResult;
  }

  throw new Error('Scene image failed. Requires GOOGLE_CLOUD_PROJECT (Vertex Imagen) with billing enabled.');
}
