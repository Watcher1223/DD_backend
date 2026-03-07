// ═══════════════════════════════════════════════
// MUSIC ENGINE — Theme → WeightedPrompts for Lyria RealTime
// Bedtime story: maps theme/mood/emotion to music descriptors.
// ═══════════════════════════════════════════════

const DELTA_THRESHOLD = 0.15;

/** Theme keys supported for music (user description is mapped to one of these). */
export const THEME_KEYS = [
  'bedtime',
  'calm',
  'magical forest',
  'under the sea',
  'fairy tale',
  'space adventure',
  'fantasy',
  'dragon adventure',
];

const THEME_MAP = {
  'magical forest': [
    'soft harp fantasy ambience',
    'enchanted forest cinematic music',
  ],
  'dragon adventure': [
    'epic fantasy orchestra',
    'heroic adventure score',
  ],
  bedtime: [
    'gentle lullaby piano',
    'soft ambient dream music',
  ],
  'under the sea': [
    'soft oceanic ambience',
    'gentle underwater melody',
  ],
  'space adventure': [
    'soft space ambient',
    'gentle cosmic pads',
  ],
  'fairy tale': [
    'soft magical twinkling',
    'gentle fairy tale melody',
  ],
  calm: [
    'soft ambient cinematic',
    'gentle peaceful music',
  ],
  fantasy: [
    'soft cinematic fantasy',
    'gentle orchestral ambience',
  ],
  default: [
    'soft ambient cinematic background',
    'gentle instrumental music',
  ],
};

const EMOTION_MAP = {
  sleepy: 0.2,
  happy: 0.6,
  excited: 0.9,
  sad: 0.3,
  neutral: 0.5,
  calm: 0.3,
  scared: 0.7,
  curious: 0.5,
  peaceful: 0.2,
};

/** Last applied scene for throttling */
let lastScene = {
  theme: null,
  mood: null,
  intensity: null,
};

/**
 * Generate WeightedPrompts for Lyria RealTime from scene signals.
 * @param {object} scene - { theme, genre, mood, intensity, emotion } (all optional)
 * @returns {{ weightedPrompts: Array<{ text: string, weight: number }> }}
 */
export function generateMusicPrompts(scene) {
  const theme = normalizeString(scene?.theme) || 'bedtime';
  const mood = normalizeString(scene?.mood) || 'calm';
  const rawIntensity = typeof scene?.intensity === 'number' ? scene.intensity : 0.5;
  const emotion = normalizeString(scene?.emotion) || 'neutral';

  const emotionIntensity = EMOTION_MAP[emotion] ?? EMOTION_MAP.neutral;
  const intensity = Math.max(0, Math.min(1, (rawIntensity + emotionIntensity) / 2));

  const descriptors = THEME_MAP[theme] || THEME_MAP.default;

  const weightedPrompts = [];
  for (let i = 0; i < descriptors.length; i++) {
    const weight = Math.max(0.1, intensity * (1 - i * 0.3));
    weightedPrompts.push({
      text: `${descriptors[i]}, ${mood} atmosphere`,
      weight,
    });
  }

  return { weightedPrompts, theme, mood, intensity };
}

/**
 * Whether the new scene warrants sending an update to Lyria (throttle).
 * @param {object} next - { theme, mood, intensity } from generateMusicPrompts
 * @returns {boolean}
 */
export function shouldUpdatePrompts(next) {
  if (lastScene.theme !== next.theme || lastScene.mood !== next.mood) {
    return true;
  }
  if (lastScene.intensity == null) return true;
  return Math.abs(next.intensity - lastScene.intensity) > DELTA_THRESHOLD;
}

/**
 * Record that we applied this scene (for throttling).
 * @param {object} applied - { theme, mood, intensity }
 */
export function markPromptsApplied(applied) {
  lastScene = {
    theme: applied.theme,
    mood: applied.mood,
    intensity: applied.intensity,
  };
}

/**
 * Reset throttle state (e.g. when session ends).
 */
export function resetThrottle() {
  lastScene = { theme: null, mood: null, intensity: null };
}

function normalizeString(s) {
  if (s == null || typeof s !== 'string') return null;
  return s.toLowerCase().trim() || null;
}

/** Default prompts for session start (calm lullaby). */
export const DEFAULT_WEIGHTED_PROMPTS = [
  { text: 'gentle lullaby piano, soft ambient dream music', weight: 0.8 },
  { text: 'quiet bedtime atmosphere, calm', weight: 0.4 },
];
