// ═══════════════════════════════════════════════
// LYRIA — Adaptive Music Engine
// Vertex AI Lyria 2 only; no preset or silence fallback.
// ═══════════════════════════════════════════════

import { GoogleAuth } from 'google-auth-library';

const GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_AI_PROJECT;
const VERTEX_LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';

// Lyria 2: minimal prompts to avoid recitation blocks (no genre terms, no famous-style phrases)
const MOOD_PROMPTS = {
  tavern: 'Instrumental only. Soft, warm, quiet. No lyrics or vocals.',
  forest: 'Instrumental only. Open, soft, peaceful. No lyrics or vocals.',
  battle: 'Instrumental only. Rhythmic, intense, short. No lyrics or vocals.',
  mystery: 'Instrumental only. Sparse, quiet, minor. No lyrics or vocals.',
  victory: 'Instrumental only. Bright, short, uplifting. No lyrics or vocals.',
  danger: 'Instrumental only. Low notes, slow, tense. No lyrics or vocals.',
  calm: 'Instrumental only. Slow, soft, simple. No lyrics or vocals.',
  epic: 'Instrumental only. Broad, short, neutral. No lyrics or vocals.',
};

/**
 * Whether Vertex AI Lyria 2 is configured (Google Cloud project set).
 */
export function isVertexLyriaConfigured() {
  return !!GOOGLE_CLOUD_PROJECT;
}

/**
 * Generate music with Vertex AI Lyria 2. Returns WAV buffer or null on failure.
 * @param {string} mood - One of: tavern, forest, battle, mystery, victory, danger, calm, epic
 * @returns {Promise<Buffer|null>}
 */
export async function generateLyriaAudio(mood) {
  if (!GOOGLE_CLOUD_PROJECT) {
    return null;
  }
  const normalizedMood = mood.toLowerCase().trim();
  const prompt =
    process.env.LYRIA_PROMPT_OVERRIDE ||
    MOOD_PROMPTS[normalizedMood] ||
    MOOD_PROMPTS.calm;

  try {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) {
      console.error('[LYRIA] No access token from Google Auth');
      return null;
    }

    const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/lyria-002:predict`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.token}`,
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {},
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[LYRIA] Vertex predict error:', res.status, errText);
      return null;
    }

    const data = await res.json();
    const predictions = data.predictions;
    if (!predictions || !predictions.length) {
      console.error('[LYRIA] No predictions in response');
      return null;
    }

    const first = predictions[0];
    const b64 = first.audioContent ?? first.bytesBase64Encoded ?? first.bytesBase64encoded;
    if (!b64) {
      console.error('[LYRIA] No audioContent/bytesBase64Encoded in prediction');
      return null;
    }

    return Buffer.from(b64, 'base64');
  } catch (err) {
    console.error('[LYRIA] Vertex generation error:', err.message);
    return null;
  }
}

/**
 * Get music for a given mood. Requires Vertex Lyria (GOOGLE_CLOUD_PROJECT); no preset.
 * @param {string} mood - One of: tavern, forest, battle, mystery, victory, danger, calm, epic
 * @returns {object} { audioUrl: null, mood, description, source: 'lyria' }
 */
export async function getMusicForMood(mood) {
  const normalizedMood = (mood || 'calm').toLowerCase().trim();
  if (!GOOGLE_CLOUD_PROJECT) {
    throw new Error('Music requires Vertex Lyria. Set GOOGLE_CLOUD_PROJECT in .env and enable billing.');
  }
  return {
    audioUrl: null,
    mood: normalizedMood,
    description: `AI-generated ${normalizedMood} music (Lyria 2)`,
    source: 'lyria',
  };
}

/**
 * Get all available moods.
 */
export function getAvailableMoods() {
  return Object.keys(MOOD_PROMPTS);
}
