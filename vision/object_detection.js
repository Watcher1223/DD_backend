// ═══════════════════════════════════════════════
// OBJECT DETECTION — Detect toy/doll in frame for protagonist
// Uses Gemini Vision to find the most prominent toy-like object (doll, stuffed animal, etc.).
// ═══════════════════════════════════════════════

import { parseGeminiJson } from '../ai/parse_json.js';
import { parseFrame } from '../utils/media.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
const GEMINI_VISION_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent`;

const OBJECT_PROMPT = `Look at this image. Identify any TOY-LIKE objects held by a person or visible in frame: doll, stuffed animal, action figure, plushie, teddy bear, etc.

Pick the ONE most prominent such object (e.g. held in the center of the frame). Return ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "objects": [
    {
      "name": "short name e.g. stuffed bear",
      "description": "2-6 word visual description for an image generator, e.g. small brown bear with red shirt",
      "prominence": "held_center or visible or none"
    }
  ]
}

If no toy/doll is clearly visible, return: {"objects": []}. Keep description brief and visual.`;

/**
 * Detect the most prominent toy/doll in a webcam frame for use as story protagonist.
 * @param {string} frameBase64 - Base64 or data URL from webcam
 * @returns {Promise<{ objects: Array<{ name: string, description: string, prominence: string }>, protagonist_description?: string }>}
 */
export async function detectToyInFrame(frameBase64) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    throw new Error('Gemini API key required. Set GEMINI_API_KEY in .env');
  }
  if (!frameBase64) {
    throw new Error('No frame provided for object detection');
  }

  const frame = parseFrame(frameBase64);

  const res = await fetch(`${GEMINI_VISION_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: OBJECT_PROMPT },
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
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const errMsg = data.error?.message || res.statusText || 'Unknown error';
    throw new Error(`Object detection failed: ${errMsg}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = text ? parseGeminiJson(text, { objects: [] }) : { objects: [] };
  const objects = Array.isArray(parsed.objects) ? parsed.objects : [];

  const toy = objects.find(
    (o) => o && (o.prominence === 'held_center' || o.prominence === 'visible')
  ) || objects[0];
  const protagonist_description = toy && (toy.description || toy.name) ? (toy.description || toy.name).trim() : undefined;

  return {
    objects: objects.filter((o) => o && o.name),
    protagonist_description,
  };
}
