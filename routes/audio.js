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
 * Generates music with Vertex AI Lyria 2 and streams WAV. Used when Lyria is configured.
 */
router.get('/music/generate', async (req, res) => {
  const mood = req.query.mood;
  if (!mood || typeof mood !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid mood query parameter' });
  }
  try {
    const wavBuffer = await generateLyriaAudio(mood.trim());
    if (!wavBuffer || wavBuffer.length === 0) {
      return res.status(502).json({ error: 'Lyria generation failed or Vertex AI not configured' });
    }
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(wavBuffer);
  } catch (err) {
    console.error('[MUSIC] Lyria generate error:', err.message);
    res.status(502).json({ error: 'Failed to generate music' });
  }
});

/**
 * GET /api/tts?text=<encoded_text>
 * Returns narration as speech audio (proxied TTS) so the client can play it.
 * Long text is truncated to stay within TTS limits.
 */
router.get('/tts', async (req, res) => {
  const text = req.query.text;
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
    ttsUrl.searchParams.set('tl', 'en');
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
