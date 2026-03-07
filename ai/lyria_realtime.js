// ═══════════════════════════════════════════════
// LYRIA REALTIME — WebSocket client for continuous music
// Uses Gemini API (v1alpha) models/lyria-realtime-exp.
// ═══════════════════════════════════════════════

import { GoogleGenAI } from '@google/genai';

const LYRIA_MODEL = process.env.LYRIA_REALTIME_MODEL || 'models/lyria-realtime-exp';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/**
 * Whether Lyria RealTime is configured (Gemini API key set).
 */
export function isLyriaRealtimeConfigured() {
  return !!GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here';
}

/**
 * Create a Lyria RealTime session and return a handle to update prompts and receive audio.
 * @param {object} opts
 * @param {function(Buffer): void} opts.onAudioChunk - Called with raw PCM (16-bit, 48kHz stereo) for each chunk
 * @param {function(): void} [opts.onClose] - Called when the session ends
 * @param {function(Error): void} [opts.onError] - Called on error
 * @returns {Promise<{ updatePrompts: (weightedPrompts: Array<{ text: string, weight: number }>) => Promise<void>, close: () => void }>}
 */
export async function createLyriaRealtimeSession(opts) {
  const { onAudioChunk, onClose, onError } = opts || {};

  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    throw new Error('Lyria RealTime requires GEMINI_API_KEY in .env (Gemini API, not Vertex).');
  }

  const client = new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
    httpOptions: { apiVersion: 'v1alpha' },
  });

  const session = await client.live.music.connect({
    model: LYRIA_MODEL,
    callbacks: {
      onmessage(message) {
        const chunk = message.audioChunk;
        if (chunk?.data) {
          const buf = Buffer.from(chunk.data, 'base64');
          if (onAudioChunk && buf.length > 0) {
            onAudioChunk(buf);
          }
        }
      },
      onerror(e) {
        if (onError) onError(e?.error || e);
        else console.error('[LYRIA_REALTIME] Error:', e);
      },
      onclose() {
        if (onClose) onClose();
      },
    },
  });

  return {
    async updatePrompts(weightedPrompts) {
      if (!weightedPrompts?.length) return;
      await session.setWeightedPrompts({ weightedPrompts });
    },
    setMusicGenerationConfig(config) {
      return session.setMusicGenerationConfig({ musicGenerationConfig: config || {} });
    },
    play() {
      session.play();
    },
    close() {
      session.close();
    },
  };
}
