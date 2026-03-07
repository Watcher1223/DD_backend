// ═══════════════════════════════════════════════
// EMOTION ANALYSIS — Camera → emotion for music
// Uses Gemini Vision to infer viewer emotion from
// a webcam frame and return signals for Lyria RealTime.
// ═══════════════════════════════════════════════

import { parseGeminiJson } from '../ai/parse_json.js';
import { parseFrame } from './frame_utils.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
const GEMINI_VISION_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent`;

const EMOTION_PROMPT = `Look at the person or people in this image. Infer the PRIMARY emotional state from their face, posture, and context (e.g. bedtime, relaxing).

Focus on one main viewer if multiple people. Return ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "emotion": "one of: sleepy, happy, excited, sad, neutral, calm, scared, curious, peaceful",
  "mood": "one of: calm, peaceful, sleepy, gentle, dreamy, tense, sad, happy",
  "intensity": 0.0 to 1.0
}

Keep intensity low (0.2-0.4) for sleepy/calm/peaceful, medium (0.4-0.6) for happy/curious, higher (0.6-0.8) for excited. Use child-friendly, gentle interpretations. Theme/setting is provided by the user separately — do not infer theme from the image.`;

const DEFAULTS = {
  emotion: 'neutral',
  mood: 'calm',
  intensity: 0.3,
};

/**
 * Analyze a webcam frame and return emotion/mood/intensity for music (theme comes from user description, not image).
 * @param {string} frameBase64 - Base64 or data URL from webcam
 * @returns {Promise<{ emotion: string, mood: string, intensity: number }>}
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
  if (!parsed) return DEFAULTS;

  const emotion = normalizeEmotion(parsed.emotion);
  const mood = normalizeMood(parsed.mood);
  const intensity = clamp(Number(parsed.intensity), 0, 1);

  return {
    emotion: emotion || DEFAULTS.emotion,
    mood: mood || DEFAULTS.mood,
    intensity: Number.isNaN(intensity) ? DEFAULTS.intensity : intensity,
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

function clamp(n, min, max) {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}
