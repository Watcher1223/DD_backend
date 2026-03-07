// ═══════════════════════════════════════════════
// EMOTION ANALYSIS — Camera → emotion for music
// Uses Gemini Vision to infer viewer emotion from
// a webcam frame and return signals for Lyria RealTime.
// ═══════════════════════════════════════════════

import { parseGeminiJson } from '../ai/parse_json.js';
import { parseFrame } from '../utils/media.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
const GEMINI_VISION_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent`;

const EMOTION_PROMPT = `Look at the person or people in this image. Infer the PRIMARY emotional state from their face, posture, and context (e.g. bedtime, relaxing).

Also detect these distinct STAGE EVENTS if clearly visible (pick at most one, or none):
- yawn: mouth open, eyes relaxed or closed, sleepy/drowsy expression
- laugh: big smile, eyes crinkled or squinting, joyful expression
- scared: wide eyes, tense expression, fear or surprise

Focus on one main viewer if multiple people. Return ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "emotion": "one of: sleepy, happy, excited, sad, neutral, calm, scared, curious, peaceful",
  "mood": "one of: calm, peaceful, sleepy, gentle, dreamy, tense, sad, happy",
  "intensity": 0.0 to 1.0,
  "detected_events": ["yawn"] or ["laugh"] or ["scared"] or []
}

Use detected_events only when the corresponding expression is clear. If unsure, use []. Keep intensity low (0.2-0.4) for sleepy/calm/peaceful, medium (0.4-0.6) for happy/curious, higher (0.6-0.8) for excited. Theme/setting is provided by the user separately — do not infer theme from the image.`;

const DEFAULTS = {
  emotion: 'neutral',
  mood: 'calm',
  intensity: 0.3,
  detected_events: [],
};

/**
 * Analyze a webcam frame and return emotion/mood/intensity and optional stage events (yawn/laugh/scared) for music.
 * @param {string} frameBase64 - Base64 or data URL from webcam
 * @returns {Promise<{ emotion: string, mood: string, intensity: number, detected_events?: string[] }>}
 */
export async function analyzeEmotionFromFrame(frameBase64) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    throw new Error('Gemini API key required. Set GEMINI_API_KEY in .env');
  }
  if (!frameBase64) {
    throw new Error('No frame provided for emotion analysis');
  }

  const frame = parseFrame(frameBase64);

  const res = await fetch(`${GEMINI_VISION_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: EMOTION_PROMPT },
          {
            inline_data: {
              mime_type: frame.mimeType,
              data: frame.data,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const errMsg = data.error?.message || res.statusText || 'Unknown error';
    throw new Error(`Emotion analysis failed: ${errMsg}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return DEFAULTS;
  }

  const parsed = parseGeminiJson(text, DEFAULTS);
  if (!parsed) return { ...DEFAULTS, detected_events: [] };

  const emotion = normalizeEmotion(parsed.emotion);
  const mood = normalizeMood(parsed.mood);
  const intensity = clamp(Number(parsed.intensity), 0, 1);
  const detected_events = normalizeDetectedEvents(parsed.detected_events);

  return {
    emotion: emotion || DEFAULTS.emotion,
    mood: mood || DEFAULTS.mood,
    intensity: Number.isNaN(intensity) ? DEFAULTS.intensity : intensity,
    detected_events,
  };
}

const VALID_EMOTIONS = new Set(['sleepy', 'happy', 'excited', 'sad', 'neutral', 'calm', 'scared', 'curious', 'peaceful']);
const VALID_MOODS = new Set(['calm', 'peaceful', 'sleepy', 'gentle', 'dreamy', 'tense', 'sad', 'happy']);

function normalizeEmotion(s) {
  const v = (s && String(s).toLowerCase().trim()) || '';
  if (VALID_EMOTIONS.has(v)) return v;
  if (/sleep|tired|drowsy/.test(v)) return 'sleepy';
  if (/joy|smile|glad/.test(v)) return 'happy';
  if (/sad|down|low/.test(v)) return 'sad';
  if (/peace|relax|serene/.test(v)) return 'peaceful';
  if (/fear|anxious|worried/.test(v)) return 'scared';
  if (/excit|energ|wow/.test(v)) return 'excited';
  if (/curious|interest|wonder/.test(v)) return 'curious';
  return 'neutral';
}

function normalizeMood(s) {
  const v = (s && String(s).toLowerCase().trim()) || '';
  if (VALID_MOODS.has(v)) return v;
  if (/calm|peace|gentle/.test(v)) return 'calm';
  if (/sleep|dreamy/.test(v)) return 'sleepy';
  if (/sad|melancholy/.test(v)) return 'sad';
  if (/tense|dramatic/.test(v)) return 'tense';
  return 'calm';
}

const VALID_STAGE_EVENTS = new Set(['yawn', 'laugh', 'scared']);

function normalizeDetectedEvents(val) {
  if (!Array.isArray(val)) return [];
  const out = [];
  for (const e of val) {
    const v = (e && String(e).toLowerCase().trim()) || '';
    if (VALID_STAGE_EVENTS.has(v)) out.push(v);
  }
  return out.slice(0, 1); // at most one event per frame
}

function clamp(n, min, max) {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * Map free-text vision result (e.g. from Overshoot) to our music scene schema.
 * Use a generic Overshoot prompt like: "In one word or short phrase, what is the person doing or feeling?
 * Examples: laughing, yawning, scared, happy, sleepy, neutral, excited, sad."
 * Then send the result here; no hardcoding of moods in the frontend.
 * @param {string} text - Raw result from vision (e.g. "laugh", "no laugh", "yawn", "happy", "sleepy")
 * @returns {{ emotion: string, mood: string, intensity: number, detected_events: string[] }}
 */
export function mapVisionTextToScene(text) {
  const t = (text && String(text).toLowerCase().trim()) || '';
  const detected_events = [];
  let emotion = 'neutral';
  let mood = 'calm';
  let intensity = 0.4;

  // Stage events (take first match; "no X" means skip that event)
  if (/\b(no\s+)?laugh|laughing\b/.test(t) && !/no\s+laugh/.test(t)) {
    detected_events.push('laugh');
    emotion = 'happy';
    mood = 'happy';
    intensity = 0.6;
  } else if (/\b(no\s+)?yawn|yawning\b/.test(t) && !/no\s+yawn/.test(t)) {
    detected_events.push('yawn');
    emotion = 'sleepy';
    mood = 'sleepy';
    intensity = 0.2;
  } else if (/\bscared|fear|frightened|afraid\b/.test(t)) {
    detected_events.push('scared');
    emotion = 'scared';
    mood = 'tense';
    intensity = 0.7;
  } else {
    // No stage event; infer emotion/mood from keywords
    if (/\bsleepy|sleeping|tired|drowsy\b/.test(t)) {
      emotion = 'sleepy';
      mood = 'sleepy';
      intensity = 0.25;
    } else if (/\bhappy|smile|joy|glad|cheerful\b/.test(t)) {
      emotion = 'happy';
      mood = 'happy';
      intensity = 0.55;
    } else if (/\bexcited|excitement|energetic\b/.test(t)) {
      emotion = 'excited';
      mood = 'happy';
      intensity = 0.75;
    } else if (/\bsad|sadness|down\b/.test(t)) {
      emotion = 'sad';
      mood = 'sad';
      intensity = 0.3;
    } else if (/\bcalm|peaceful|relaxed|serene\b/.test(t)) {
      emotion = 'peaceful';
      mood = 'calm';
      intensity = 0.3;
    } else if (/\bcurious|interested|wondering\b/.test(t)) {
      emotion = 'curious';
      mood = 'gentle';
      intensity = 0.5;
    } else if (/\bneutral|normal|nothing\b/.test(t) || t.length === 0) {
      emotion = 'neutral';
      mood = 'calm';
      intensity = 0.4;
    }
  }

  return {
    emotion: normalizeEmotion(emotion),
    mood: normalizeMood(mood),
    intensity: clamp(intensity, 0, 1),
    detected_events: detected_events.length ? detected_events : [],
  };
}
