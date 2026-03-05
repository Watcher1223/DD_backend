// ═══════════════════════════════════════════════
// AUDIO ROUTES — Proxy for music and TTS
// Same-origin URLs so clients can play audio without CORS issues.
// ═══════════════════════════════════════════════

import { Router } from 'express';
import { generateLyriaAudio, getPresetFallbackUrl } from '../ai/lyria.js';

const router = Router();
const REAL_DATA_ONLY = process.env.REAL_DATA_ONLY === '1' || process.env.REAL_DATA_ONLY === 'true';

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
 * Generates music with Vertex AI Lyria 2 and streams WAV. When Lyria fails, streams preset track instead.
 */
router.get('/music/generate', async (req, res) => {
  const mood = req.query.mood;
  if (!mood || typeof mood !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid mood query parameter' });
  }
  const normalizedMood = mood.trim();
  try {
    let wavBuffer = await generateLyriaAudio(normalizedMood);
    if (wavBuffer && wavBuffer.length > 0) {
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(wavBuffer);
    }
    if (REAL_DATA_ONLY) {
      return res.status(502).json({ error: 'REAL_DATA_ONLY: Lyria (Vertex AI) required for music. Set GOOGLE_CLOUD_PROJECT and run gcloud auth application-default login.' });
    }
    // Lyria failed or not configured — stream preset so client always gets audio
    const presetUrl = getPresetFallbackUrl(normalizedMood);
    const response = await fetch(presetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/119.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      console.error('[MUSIC] Preset fetch failed', response.status, presetUrl);
      return res.status(502).json({ error: 'Music unavailable' });
    }
    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const buf = await response.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('[MUSIC] Lyria generate error:', err.message);
    if (REAL_DATA_ONLY) {
      return res.status(502).json({ error: 'REAL_DATA_ONLY: Lyria (Vertex AI) required for music. Set GOOGLE_CLOUD_PROJECT and run gcloud auth application-default login.' });
    }
    const presetUrl = getPresetFallbackUrl(normalizedMood);
    try {
      const response = await fetch(presetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/119.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const contentType = response.headers.get('content-type') || 'audio/mpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        const buf = await response.arrayBuffer();
        return res.send(Buffer.from(buf));
      }
    } catch (presetErr) {
      console.error('[MUSIC] Preset fallback failed:', presetErr.message);
    }
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
