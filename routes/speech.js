// ═══════════════════════════════════════════════
// SPEECH ROUTES — Speech-to-text endpoint
// Accepts audio recordings, transcribes via
// Gemini multimodal, and returns text.
// ═══════════════════════════════════════════════

import { Router } from 'express';
import { transcribeAudio, transcribeWithLanguage } from '../ai/transcribe.js';

const router = Router();

/**
 * POST /api/speech/transcribe
 * Accept a base64-encoded audio recording and return the transcript.
 * Optionally detect the spoken language (for "speak in Swahili → story in Swahili").
 *
 * Body: { audio: string (base64), detectLanguage?: boolean }
 * Response: { transcript: string, elapsed_ms: number, detectedLanguage?: string }
 */
router.post('/speech/transcribe', async (req, res) => {
  const { audio, detectLanguage } = req.body;
  if (!audio) {
    return res.status(400).json({ error: 'audio is required (base64 encoded audio)' });
  }

  try {
    const startTime = Date.now();
    if (detectLanguage) {
      const { transcript, detectedLanguage: lang } = await transcribeWithLanguage(audio);
      return res.json({
        transcript,
        detectedLanguage: lang,
        elapsed_ms: Date.now() - startTime,
      });
    }
    const transcript = await transcribeAudio(audio);
    res.json({
      transcript,
      elapsed_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[SPEECH] Transcription error:', err);
    const status = err.message && (err.message.includes('required') || err.message.includes('failed')) ? 503 : 500;
    res.status(status).json({ error: 'Transcription failed', details: err.message });
  }
});

export default router;
