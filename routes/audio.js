// ═══════════════════════════════════════════════
// AUDIO ROUTES — Proxy for music and TTS
// Same-origin URLs so clients can play audio without CORS issues.
// ═══════════════════════════════════════════════

import { Router } from 'express';
import { generateLyriaAudio } from '../ai/lyria.js';

const router = Router();

const TTS_MAX_CHARS = 200;

/**
 * GET /api/audio?url=<encoded_url>
 * Proxies external audio (e.g. Pixabay) so the client can play it same-origin.
 */
router.get('/audio', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid url query parameter' });
  }
  try {
    const response = await fetch(rawUrl, {
      headers: { 'User-Agent': 'LivingWorlds/1.0' },
    });
    if (!response.ok) {
      return res.status(response.status).send(response.statusText);
    }
    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const buf = await response.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('[AUDIO] Proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch audio' });
  }
});

/**
 * GET /api/music/generate?mood=<mood>
 * Generates music with Vertex AI Lyria 2 and streams WAV. No preset or silence fallback; returns 502 if Lyria fails.
 */
router.get('/music/generate', async (req, res) => {
  const mood = req.query.mood;
  if (!mood || typeof mood !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid mood query parameter' });
  }
  const normalizedMood = mood.trim();
  try {
    const wavBuffer = await generateLyriaAudio(normalizedMood);
    if (wavBuffer && wavBuffer.length > 0) {
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(wavBuffer);
    }
    return res.status(502).json({
      error: 'Music generation failed',
      details: 'Vertex Lyria returned no audio (e.g. recitation block). Set GOOGLE_CLOUD_PROJECT and try a different mood or LYRIA_PROMPT_OVERRIDE.',
    });
  } catch (err) {
    console.error('[MUSIC] Lyria generate error:', err.message);
    return res.status(502).json({
      error: 'Music generation failed',
      details: err.message || 'Check GOOGLE_CLOUD_PROJECT and billing.',
    });
  }
});

/**
 * GET /api/tts?text=<encoded_text>
 * Returns narration as speech audio (proxied TTS) so the client can play it.
 * Long text is truncated to stay within TTS limits.
 */
router.get('/tts', async (req, res) => {
  const text = req.query.text;
  const lang = (req.query.lang && String(req.query.lang).trim()) || 'en';
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid text query parameter' });
  }
  const clean = decodeURIComponent(text).slice(0, TTS_MAX_CHARS).trim();
  if (!clean) {
    return res.status(400).json({ error: 'Empty text after decode' });
  }
  try {
    // Google Translate TTS (widely used for demos; no key required)
    const ttsUrl = new URL('https://translate.google.com/translate_tts');
    ttsUrl.searchParams.set('ie', 'UTF-8');
    ttsUrl.searchParams.set('q', clean);
    ttsUrl.searchParams.set('tl', lang);
    ttsUrl.searchParams.set('client', 'tw-ob');

    const response = await fetch(ttsUrl.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:91.0) Gecko/20100101 Firefox/91.0' },
    });
    if (!response.ok) {
      return res.status(response.status).send(response.statusText);
    }
    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache');
    const buf = await response.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('[TTS] Proxy error:', err.message);
    res.status(502).json({ error: 'Failed to generate speech' });
  }
});

export default router;
