// ═══════════════════════════════════════════════
// LYRIA — Adaptive Music Engine
// Generates or selects background music based on mood.
// Falls back to royalty-free ambient tracks for demo.
// ═══════════════════════════════════════════════

const LYRIA_API_KEY = process.env.LYRIA_API_KEY;

// Pre-mapped royalty-free ambient tracks for instant mood switching
// These are creative-commons / free-to-use ambient tracks
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
 * Get music for a given mood.
 * @param {string} mood - One of: tavern, forest, battle, mystery, victory, danger, calm, epic
 * @returns {object} { audioUrl, mood, description, source }
 */
export async function getMusicForMood(mood) {
  const normalizedMood = mood.toLowerCase().trim();

  // ── LYRIA API CALL ──
  // Replace with actual Lyria API when available
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
