// ═══════════════════════════════════════════════
// SCENE IMAGE — NanoBanana 2 (hackathon) → Google Imagen fallback → placeholder
// 1. NanoBanana when NANOBANANA_API_KEY is set.
// 2. Google Vertex Imagen (same GOOGLE_CLOUD_PROJECT / auth as Lyria) when NanoBanana fails or no key.
// 3. pollinations.ai placeholder when neither is available.
// ═══════════════════════════════════════════════

import { GoogleAuth } from 'google-auth-library';

const NANOBANANA_API_KEY = process.env.NANOBANANA_API_KEY;
const GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_AI_PROJECT;
const VERTEX_LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';

const IMAGEN_MODEL = process.env.IMAGEN_MODEL || 'imagen-3.0-fast-generate-001';

const REAL_DATA_ONLY = process.env.REAL_DATA_ONLY === '1' || process.env.REAL_DATA_ONLY === 'true';

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
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) {
      console.error('[IMAGEN] No access token from Google Auth');
      return null;
    }

    const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${IMAGEN_MODEL}:predict`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.token}`,
      },
      body: JSON.stringify({
        instances: [{ prompt: scenePrompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '16:9',
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[IMAGEN] Vertex predict error:', res.status, errText);
      return null;
    }

    const data = await res.json();
    const predictions = data.predictions;
    if (!predictions || !predictions.length) {
      console.error('[IMAGEN] No predictions in response');
      return null;
    }

    const first = predictions[0];
    const b64 = first.bytesBase64Encoded ?? first.bytesBase64encoded;
    const mimeType = first.mimeType || 'image/png';
    if (!b64) {
      console.error('[IMAGEN] No bytesBase64Encoded in prediction');
      return null;
    }

    const imageUrl = `data:${mimeType};base64,${b64}`;
    return { imageUrl, source: 'imagen' };
  } catch (err) {
    console.error('[IMAGEN] Generation error:', err.message);
    return null;
  }
}

/**
 * Generate a scene image from a text prompt.
 * Order: NanoBanana 2 (if key set) → Google Vertex Imagen (if GOOGLE_CLOUD_PROJECT set) → placeholder.
 * @param {string} scenePrompt - Visual description of the scene
 * @returns {object} { imageUrl, source }
 */
export async function generateSceneImage(scenePrompt) {
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

  // ── Vertex AI Imagen (Google Cloud fallback; same project/auth as Lyria) ──
  const imagenResult = await generateWithImagen(scenePrompt);
  if (imagenResult) {
    return imagenResult;
  }

  // ── PLACEHOLDER FALLBACK ──
  if (REAL_DATA_ONLY) {
    throw new Error('REAL_DATA_ONLY: Scene image requires NANOBANANA_API_KEY or GOOGLE_CLOUD_PROJECT (Vertex Imagen). No placeholder allowed.');
  }
  const imageUrl = generatePlaceholderUrl(scenePrompt);
  return { imageUrl, source: 'placeholder' };
}

/**
 * Generate a themed placeholder image URL (pollinations.ai, no key).
 */
function generatePlaceholderUrl(prompt) {
  const encoded = encodeURIComponent(prompt + ', high quality, 4k, detailed');
  return `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=576&nologo=true`;
}
