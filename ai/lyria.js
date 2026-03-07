// ═══════════════════════════════════════════════
// LYRIA — Adaptive Music Engine
// Vertex AI Lyria 2 only; no preset or silence fallback.
// ═══════════════════════════════════════════════

import { GoogleAuth } from 'google-auth-library';

const GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_AI_PROJECT;
const VERTEX_LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';

// Lyria 2: very short, generic prompts to avoid recitation blocks (Vertex can block on genre/famous-style terms)
const MOOD_PROMPTS = {
  tavern: 'Instrumental. Soft and quiet. No vocals.',
  forest: 'Instrumental. Peaceful and soft. No vocals.',
  battle: 'Instrumental. Rhythmic and intense. No vocals.',
  mystery: 'Instrumental. Quiet, sparse. No vocals.',
  victory: 'Instrumental. Uplifting, short. No vocals.',
  danger: 'Instrumental. Slow, tense. No vocals.',
  calm: 'Instrumental. Soft, slow. No vocals.',
  epic: 'Instrumental. Broad, neutral. No vocals.',
};

// Fallback if recitation block: single minimal prompt
const RECITATION_FALLBACK_PROMPT = 'Instrumental only. No vocals. Ambient.';

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
  let prompt =
    process.env.LYRIA_PROMPT_OVERRIDE ||
    MOOD_PROMPTS[normalizedMood] ||
    MOOD_PROMPTS.calm;

  const tryGenerate = async (p) => {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) {
      console.error('[LYRIA] No access token from Google Auth');
      return { buffer: null, status: null, body: null };
    }

    const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/lyria-002:predict`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.token}`,
      },
      body: JSON.stringify({
        instances: [{ prompt: p }],
        parameters: {},
      }),
    });

    const errText = await res.text();
    if (!res.ok) {
      return { buffer: null, status: res.status, body: errText };
    }
    try {
      const data = JSON.parse(errText);
      const predictions = data.predictions;
      if (!predictions || !predictions.length) {
        return { buffer: null, status: res.status, body: errText };
      }
      const first = predictions[0];
      const b64 = first.audioContent ?? first.bytesBase64Encoded ?? first.bytesBase64encoded;
      if (!b64) return { buffer: null, status: res.status, body: errText };
      return { buffer: Buffer.from(b64, 'base64'), status: res.status, body: null };
    } catch {
      return { buffer: null, status: res.status, body: errText };
    }
  };

  try {
    let result = await tryGenerate(prompt);
    if (result.buffer) return result.buffer;
    if (result.status === 400 && result.body && result.body.includes('recitation')) {
      console.warn('[LYRIA] Recitation block, retrying with minimal prompt');
      result = await tryGenerate(RECITATION_FALLBACK_PROMPT);
      if (result.buffer) return result.buffer;
    }
    if (result.body) {
      console.error('[LYRIA] Vertex predict error:', result.status, result.body);
    }
    return null;
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
