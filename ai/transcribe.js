// ═══════════════════════════════════════════════
// TRANSCRIBE — Speech-to-Text via Gemini
// Sends audio to Gemini multimodal for
// transcription. Returns plain text transcript.
// ═══════════════════════════════════════════════

import { parseAudio } from '../utils/media.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent`;

const TRANSCRIBE_PROMPT = 'Transcribe the speech in this audio clip. Return ONLY the transcribed text, nothing else. If no speech is detected, return an empty string.';

const TRANSCRIBE_WITH_LANGUAGE_PROMPT = `Transcribe the speech in this audio clip. Then on a new line write the ISO 639-1 two-letter language code of the language spoken (e.g. en, sw, ru, es, fr). If multiple languages or unclear, use the dominant language. Use lowercase.

Format (exactly):
<transcript text here>
<language code>

If no speech is detected, return:
(empty line)
en`;

/**
 * Transcribe audio and detect the spoken language (e.g. for "speak in Swahili → story in Swahili").
 * @param {string} audioBase64 - Base64 encoded audio (with or without data URL prefix)
 * @returns {Promise<{ transcript: string, detectedLanguage: string }>}
 */
export async function transcribeWithLanguage(audioBase64) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    throw new Error('Gemini API key required for speech transcription. Set GEMINI_API_KEY in .env');
  }
  if (!audioBase64) {
    throw new Error('No audio provided for transcription');
  }

  const audio = parseAudio(audioBase64);

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: TRANSCRIBE_WITH_LANGUAGE_PROMPT },
          {
            inline_data: {
              mime_type: audio.mimeType,
              data: audio.data,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const errMsg = data.error?.message || res.statusText || 'Unknown error';
    console.error('[TRANSCRIBE] API error:', res.status, errMsg);
    throw new Error(`Transcription failed: ${errMsg}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text == null) {
    return { transcript: '', detectedLanguage: 'en' };
  }

  const lines = text.trim().split(/\n/).map((s) => s.trim()).filter(Boolean);
  let transcript = '';
  let detectedLanguage = 'en';
  if (lines.length >= 2) {
    const lastLine = lines[lines.length - 1];
    if (/^[a-z]{2,3}$/.test(lastLine)) {
      detectedLanguage = lastLine;
      transcript = lines.slice(0, -1).join(' ').trim();
    } else {
      transcript = text.trim();
    }
  } else if (lines.length === 1) {
    transcript = lines[0];
    if (/^[a-z]{2,3}$/.test(transcript)) {
      detectedLanguage = transcript;
      transcript = '';
    }
  }

  return { transcript, detectedLanguage };
}

/**
 * Transcribe audio to text using Gemini multimodal.
 * @param {string} audioBase64 - Base64 encoded audio (with or without data URL prefix)
 * @returns {Promise<string>} Plain text transcript
 */
export async function transcribeAudio(audioBase64) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    throw new Error('Gemini API key required for speech transcription. Set GEMINI_API_KEY in .env');
  }

  if (!audioBase64) {
    throw new Error('No audio provided for transcription');
  }

  const audio = parseAudio(audioBase64);

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: TRANSCRIBE_PROMPT },
          {
            inline_data: {
              mime_type: audio.mimeType,
              data: audio.data,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
      },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    const errMsg = data.error?.message || res.statusText || 'Unknown error';
    console.error('[TRANSCRIBE] API error:', res.status, errMsg);
    throw new Error(`Transcription failed: ${errMsg}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text == null) {
    throw new Error('Transcription returned empty response');
  }

  return text.trim();
}
