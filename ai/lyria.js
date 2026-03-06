// ═══════════════════════════════════════════════
// LYRIA — Adaptive Music Engine
// Vertex AI Lyria 2 only; no preset or silence fallback.
// ═══════════════════════════════════════════════

import { GoogleAuth } from 'google-auth-library';

const GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_AI_PROJECT;
const VERTEX_LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';

// Lyria 2 text prompts: abstract, instrumental, to reduce recitation blocks
const MOOD_PROMPTS = {
  tavern: 'Short instrumental piece. Cozy room tone, soft plucked strings, quiet and warm. No lyrics.',
  forest: 'Short instrumental piece. Open space, soft high tones, gentle low drone. Peaceful. No lyrics.',
  battle: 'Short instrumental piece. Driving rhythm, low brass and drums, building intensity. No lyrics.',
  mystery: 'Short instrumental piece. Sparse notes, long reverb, minor key. Unsettling but not loud. No lyrics.',
  victory: 'Short instrumental piece. Bright major key, rising melody, full but short. No lyrics.',
  danger: 'Short instrumental piece. Low sustained notes, slow pulse, tension. No lyrics.',
  calm: 'Short instrumental piece. Slow tempo, simple melody, soft pads. Relaxing. No lyrics.',
  epic: 'Short instrumental piece. Large ensemble, broad strokes, cinematic feel. No lyrics.',
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
  const prompt = MOOD_PROMPTS[normalizedMood] || MOOD_PROMPTS.calm;

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
