// ═══════════════════════════════════════════════
// CHARACTER ANALYSIS — Webcam Vision System
// Identifies people in camera frames and extracts
// structured appearance descriptions for story
// illustration generation.
// Uses Gemini Vision (multimodal).
// ═══════════════════════════════════════════════

import { parseGeminiJson } from '../ai/parse_json.js';
import { parseFrame } from '../utils/media.js';
import { fetchWithRetry } from '../utils/fetch_retry.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
const GEMINI_VISION_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent`;

const ANALYSIS_PROMPT = `Analyze this image and identify every person visible.
For each person, provide a structured description of their appearance for use in a bedtime-story illustration pipeline.

Label each person as "child" or "adult" based on apparent age.
If multiple children or adults appear, append a number (e.g. "child_1", "child_2").

Keep the label grounded ("child", "adult"), but also invent a gentle storybook-style fantasy name inspired by the person's appearance.
Write one short character_description that sounds like a warm illustrated storybook caption.

For each person, estimate the bounding box of their face as normalized coordinates (0.0-1.0 relative to image width/height). x,y is the top-left corner.

Also briefly describe the setting/environment visible in the frame.

Respond with ONLY valid JSON in this exact format:
{
  "people": [
    {
      "label": "child or adult (with optional number suffix)",
      "fantasy_name": "storybook-inspired character name",
      "character_description": "warm one-sentence storybook description",
      "hair": "color, length, style",
      "clothing": "description of visible clothing",
      "features": "distinguishing features like glasses, freckles, etc",
      "skin_tone": "natural skin tone description (e.g. light, medium, olive, tan, brown, dark brown)",
      "age_range": "estimated age range like 5-7",
      "face_box": { "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 }
    }
  ],
  "setting": "brief description of the environment"
}

If no people are visible, return: {"people": [], "setting": "description of what you see"}`;

const ANALYSIS_DEFAULTS = {
  people: [],
  setting: 'unknown',
};

/**
 * Analyze a webcam frame to extract character appearance descriptions.
 * @param {string} frameBase64 - Base64 encoded JPEG/PNG image from webcam
 * @returns {Promise<{people: Array<{label: string, fantasy_name: string, character_description: string, hair: string, clothing: string, features: string, age_range: string}>, setting: string}>}
 */
export async function analyzeCharacters(frameBase64) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    throw new Error('Gemini API key required for character analysis. Set GEMINI_API_KEY in .env');
  }

  if (!frameBase64) {
    throw new Error('No frame provided for character analysis');
  }

  const frame = parseFrame(frameBase64);

  const res = await fetchWithRetry(`${GEMINI_VISION_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: ANALYSIS_PROMPT },
          {
            inline_data: {
              mime_type: frame.mimeType,
              data: frame.data,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    }),
  }, { label: 'CHARACTER VISION' });

  const data = await res.json();

  if (!res.ok) {
    const errMsg = data.error?.message || res.statusText || 'Unknown error';
    console.error('[CHARACTER VISION] API error:', res.status, errMsg);
    throw new Error(`Character analysis failed: ${errMsg}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Character analysis returned empty response');
  }

  return parseGeminiJson(text, ANALYSIS_DEFAULTS);
}

