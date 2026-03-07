// ═══════════════════════════════════════════════
// DICE DETECTION — Webcam Vision System
// Detects d20 dice rolls from webcam frames.
// Uses Gemini vision for accurate detection,
// with simulated fallback for demo.
// ═══════════════════════════════════════════════

import { parseFrame } from './frame_utils.js';
import { parseGeminiJson } from '../ai/parse_json.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_VISION_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const DICE_DEFAULTS = { detected: false, value: null };

/**
 * Detect a dice roll from a base64-encoded webcam frame.
 * @param {string} frameBase64 - Base64 encoded JPEG/PNG image from webcam
 * @returns {object} { detected: boolean, value: number|null, confidence: number }
 */
export async function detectDiceRoll(frameBase64) {
  // ── GEMINI VISION API CALL ──
  // Use Gemini's multimodal capability to read the dice
  if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here' && frameBase64) {
    try {
      const frame = parseFrame(frameBase64);

      const res = await fetch(`${GEMINI_VISION_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: 'Look at this image. Is there a polyhedral die (like a d20) visible? If yes, what number is showing on the top face? Respond with ONLY JSON: {"detected": true, "value": <number>} or {"detected": false, "value": null}',
              },
              {
                inline_data: {
                  mime_type: frame.mimeType,
                  data: frame.data,
                },
              },
            ],
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 50,
            responseMimeType: 'application/json',
          },
        }),
      });

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const result = parseGeminiJson(text, DICE_DEFAULTS);
        return {
          detected: result.detected,
          value: result.value,
          confidence: result.detected ? 0.85 : 0,
        };
      }
    } catch (err) {
      console.error('[DICE VISION] API error, falling back to simulation:', err.message);
    }
  }

  // ── SIMULATED DICE ROLL FALLBACK ──
  // Weighted distribution to make demo more dramatic
  return simulateDiceRoll();
}

/**
 * Simulate a d20 roll with slightly dramatic weighting.
 * Higher chance of extreme results (1, 20) for exciting demos.
 */
function simulateDiceRoll() {
  const rand = Math.random();

  let value;
  if (rand < 0.08) {
    value = 20; // 8% chance of nat 20 (normally 5%)
  } else if (rand < 0.14) {
    value = 1; // 6% chance of nat 1 (normally 5%)
  } else {
    value = Math.floor(Math.random() * 18) + 2; // 2-19
  }

  return {
    detected: true,
    value,
    confidence: 1.0,
    simulated: true,
  };
}
