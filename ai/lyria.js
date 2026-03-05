// ═══════════════════════════════════════════════
// LYRIA — Adaptive Music Engine
// Supports Google Vertex AI Lyria 2 (text-to-music) when configured.
// Falls back to royalty-free preset tracks otherwise.
// ═══════════════════════════════════════════════

import { GoogleAuth } from 'google-auth-library';

const LYRIA_API_KEY = process.env.LYRIA_API_KEY;
const GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_AI_PROJECT;
const VERTEX_LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';

// Lyria 2 text prompts per mood (US English, instrumental)
const MOOD_PROMPTS = {
  tavern: 'Warm medieval tavern ambiance with lute and soft chatter, acoustic folk, gentle strings.',
  forest: 'Mystical forest atmosphere with birdsong and wind through ancient trees, peaceful ambient.',
  battle: 'Intense orchestral combat music with drums and brass, epic action, dramatic.',
  mystery: 'Eerie atmospheric music with subtle tension, suspenseful, dark ambient.',
  victory: 'Triumphant fanfare with soaring strings and brass, heroic, celebratory.',
  danger: 'Dark ominous tones with heartbeat-like percussion, threatening, suspense.',
  calm: 'Peaceful ambient music with gentle harp and soft pads, relaxing.',
  epic: 'Grand orchestral theme with choir and full orchestra, cinematic, majestic.',
};

// Pre-mapped royalty-free ambient tracks for instant mood switching (fallback)
const MOOD_TRACKS = {
  tavern: {
    url: '/audio/tavern.mp3',
    description: 'Warm medieval tavern ambiance with lute and chatter',
    fallbackUrl: 'https://cdn.pixabay.com/audio/2024/11/06/audio_ae8b5c94d3.mp3',
  },
  forest: {
    url: '/audio/forest.mp3',
    description: 'Mystical forest with birdsong and wind through ancient trees',
    fallbackUrl: 'https://cdn.pixabay.com/audio/2022/10/18/audio_29e6d6faa8.mp3',
  },
  battle: {
    url: '/audio/battle.mp3',
    description: 'Intense orchestral combat music with drums and brass',
    fallbackUrl: 'https://cdn.pixabay.com/audio/2023/07/17/audio_1b8dbb53bf.mp3',
  },
  mystery: {
    url: '/audio/mystery.mp3',
    description: 'Eerie atmospheric music with subtle tension',
    fallbackUrl: 'https://cdn.pixabay.com/audio/2024/08/27/audio_c03c764b16.mp3',
  },
  victory: {
    url: '/audio/victory.mp3',
    description: 'Triumphant fanfare with soaring strings',
    fallbackUrl: 'https://cdn.pixabay.com/audio/2022/11/22/audio_a1bd0e80c1.mp3',
  },
  danger: {
    url: '/audio/danger.mp3',
    description: 'Dark ominous tones with heartbeat-like percussion',
    fallbackUrl: 'https://cdn.pixabay.com/audio/2023/10/24/audio_3f8700c4de.mp3',
  },
  calm: {
    url: '/audio/calm.mp3',
    description: 'Peaceful ambient music with gentle harp',
    fallbackUrl: 'https://cdn.pixabay.com/audio/2024/09/10/audio_6e4e542b06.mp3',
  },
  epic: {
    url: '/audio/epic.mp3',
    description: 'Grand orchestral theme with choir and full orchestra',
    fallbackUrl: 'https://cdn.pixabay.com/audio/2023/07/17/audio_1b8dbb53bf.mp3',
  },
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
 * Get music for a given mood.
 * When Vertex Lyria is configured, returns source 'lyria' and no audioUrl (client uses GET /api/music/generate?mood=...).
 * Otherwise returns preset track URL.
 * @param {string} mood - One of: tavern, forest, battle, mystery, victory, danger, calm, epic
 * @returns {object} { audioUrl?, mood, description, source }
 */
export async function getMusicForMood(mood) {
  const normalizedMood = mood.toLowerCase().trim();

  // ── Vertex AI Lyria 2 ──
  if (isVertexLyriaConfigured()) {
    return {
      audioUrl: null,
      mood: normalizedMood,
      description: `AI-generated ${normalizedMood} music (Lyria 2)`,
      source: 'lyria',
    };
  }

  // ── Legacy placeholder: LYRIA_API_KEY (fictional api.lyria.ai) ──
  if (LYRIA_API_KEY && LYRIA_API_KEY !== 'your_lyria_api_key_here') {
    try {
      const res = await fetch('https://api.lyria.ai/v1/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LYRIA_API_KEY}`,
        },
        body: JSON.stringify({
          mood: normalizedMood,
          genre: 'fantasy_orchestral',
          duration: 60,
          loop: true,
        }),
      });
      const data = await res.json();
      if (data.audio_url) {
        return {
          audioUrl: data.audio_url,
          mood: normalizedMood,
          description: `AI-generated ${normalizedMood} music`,
          source: 'lyria',
        };
      }
    } catch (err) {
      console.error('[LYRIA] API error, falling back to preset tracks:', err.message);
    }
  }

  // ── PRESET FALLBACK ──
  const track = MOOD_TRACKS[normalizedMood] || MOOD_TRACKS.calm;
  return {
    audioUrl: track.fallbackUrl,
    mood: normalizedMood,
    description: track.description,
    source: 'preset',
  };
}

/**
 * Get all available moods.
 */
export function getAvailableMoods() {
  return Object.keys(MOOD_TRACKS);
}
