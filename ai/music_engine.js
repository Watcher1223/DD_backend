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
    'gentle music box lullaby',
    'fading starlight chimes',
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

/** Stage-event overrides: yawn → lullaby, laugh → upbeat, scared → tense. */
const STAGE_EVENT_OVERRIDES = {
  yawn: {
    prompts: [
      { text: 'soft ethereal lullaby, twinkling bells, very slow tempo', weight: 0.9 },
      { text: 'quiet bedtime atmosphere, drifting to sleep', weight: 0.5 },
    ],
    bpm: 55,
    density: 0.25,
  },
  laugh: {
    prompts: [
      { text: 'upbeat gentle whimsical melody, bright and cheerful', weight: 0.85 },
      { text: 'playful adventure theme, warm and happy', weight: 0.5 },
    ],
    bpm: 95,
    density: 0.6,
  },
  scared: {
    prompts: [
      { text: 'soft tense atmosphere, subtle minor chords, gentle suspense', weight: 0.8 },
      { text: 'quiet mysterious ambience, calming but cautious', weight: 0.4 },
    ],
    bpm: 65,
    density: 0.4,
  },
};

const WIND_DOWN_DESCRIPTORS = [
  'gentle music box lullaby',
  'soft breathing ambience',
  'fading starlight chimes',
];

/** Last applied scene for throttling */
let lastScene = {
  theme: null,
  mood: null,
  intensity: null,
};

/**
 * Generate WeightedPrompts for Lyria RealTime from scene signals.
 * When scene.detected_events contains yawn/laugh/scared, stage-event overrides are applied (stronger than baseline emotion).
 * @param {object} scene - { theme, genre, mood, intensity, emotion, storyEnergy, detected_events? } (all optional)
 * @returns {{ weightedPrompts: Array<{ text: string, weight: number }>, theme: string, mood: string, intensity: number, stageEventConfig?: { bpm: number, density: number } }}
 */
export function generateMusicPrompts(scene) {
  const detected_events = Array.isArray(scene?.detected_events) ? scene.detected_events : [];
  const stageEvent = detected_events.find((e) => STAGE_EVENT_OVERRIDES[e]);
  if (stageEvent && STAGE_EVENT_OVERRIDES[stageEvent]) {
    const override = STAGE_EVENT_OVERRIDES[stageEvent];
    return {
      weightedPrompts: override.prompts,
      theme: scene?.theme || 'bedtime',
      mood: stageEvent === 'yawn' ? 'sleepy' : stageEvent === 'laugh' ? 'happy' : 'tense',
      intensity: stageEvent === 'laugh' ? 0.65 : stageEvent === 'scared' ? 0.45 : 0.25,
      stageEventConfig: { bpm: override.bpm, density: override.density },
    };
  }

  const theme = normalizeString(scene?.theme) || 'bedtime';
  const storyEnergy = normalizeStoryEnergy(scene?.storyEnergy ?? scene?.story_energy);
  const mood = resolveWindDownMood(normalizeString(scene?.mood) || 'calm', storyEnergy);
  const rawIntensity = typeof scene?.intensity === 'number' ? scene.intensity : 0.5;
  const emotion = normalizeString(scene?.emotion) || 'neutral';

  const emotionIntensity = EMOTION_MAP[emotion] ?? EMOTION_MAP.neutral;
  const intensity = resolveWindDownIntensity(rawIntensity, emotionIntensity, storyEnergy);

  const descriptors = getDescriptors(theme, storyEnergy);

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
 * Get Lyria config (bpm, density) for a stage event. Use when applying stage-event overrides.
 * @param {string[]} detected_events
 * @returns {{ bpm: number, density: number } | null}
 */
export function getStageEventConfig(detected_events) {
  if (!Array.isArray(detected_events)) return null;
  const event = detected_events.find((e) => STAGE_EVENT_OVERRIDES[e]);
  return event ? STAGE_EVENT_OVERRIDES[event] : null;
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

/**
 * Normalize story energy into a 0..1 value.
 * @param {number|undefined} storyEnergy
 * @returns {number}
 */
function normalizeStoryEnergy(storyEnergy) {
  const numeric = Number(storyEnergy);
  if (Number.isNaN(numeric)) return 1;
  return Math.max(0, Math.min(1, numeric));
}

/**
 * Shift the mood toward sleepier descriptors as story energy drops.
 * @param {string} mood
 * @param {number} storyEnergy
 * @returns {string}
 */
function resolveWindDownMood(mood, storyEnergy) {
  if (storyEnergy <= 0.2) return 'sleepy';
  if (storyEnergy <= 0.45) return 'peaceful';
  return mood;
}

/**
 * Lower music intensity as the bedtime story winds down.
 * @param {number} rawIntensity
 * @param {number} emotionIntensity
 * @param {number} storyEnergy
 * @returns {number}
 */
function resolveWindDownIntensity(rawIntensity, emotionIntensity, storyEnergy) {
  const baseIntensity = Math.max(0, Math.min(1, (rawIntensity + emotionIntensity) / 2));
  const energyBias = 0.2 + storyEnergy * 0.6;
  return Math.max(0.08, Math.min(1, baseIntensity * energyBias));
}

/**
 * Choose theme descriptors and layer in bedtime wind-down details when needed.
 * @param {string} theme
 * @param {number} storyEnergy
 * @returns {string[]}
 */
function getDescriptors(theme, storyEnergy) {
  const baseDescriptors = THEME_MAP[theme] || THEME_MAP.default;
  if (storyEnergy > 0.5) return baseDescriptors;
  return [...baseDescriptors, ...WIND_DOWN_DESCRIPTORS];
}

/** Default prompts for session start (calm lullaby). */
export const DEFAULT_WEIGHTED_PROMPTS = [
  { text: 'gentle lullaby piano, soft ambient dream music', weight: 0.8 },
  { text: 'quiet bedtime atmosphere, calm', weight: 0.4 },
];
