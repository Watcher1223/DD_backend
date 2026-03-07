// ═══════════════════════════════════════════════
// V2V SERVICE — Video-to-Video transform interface
// transformFrame(frame, prompt) → transformed frame (mock: passthrough; later: StreamDiffusion / Luma / Decart Mirage).
// ═══════════════════════════════════════════════

/**
 * Transform a single frame with a scene prompt (story style). Mock implementation returns the input frame.
 * @param {Buffer|Uint8Array} frameBuffer - Raw frame (e.g. JPEG or RGB bytes)
 * @param {string} prompt - Scene prompt (e.g. "A hero, a magical doll, and a wise traveler in a magical forest")
 * @returns {Promise<Buffer>} Transformed frame (mock: same as input)
 */
export async function transformFrame(frameBuffer, prompt) {
  if (!frameBuffer || frameBuffer.length === 0) {
    return Buffer.from([]);
  }
  // Mock: pass through; log for testing. Replace with StreamDiffusion / Luma V2V / Decart Mirage LSD when available.
  if (process.env.NODE_ENV !== 'test') {
    console.log('[V2V] transformFrame prompt:', prompt?.slice(0, 80) + (prompt?.length > 80 ? '…' : ''));
  }
  return Buffer.isBuffer(frameBuffer) ? frameBuffer : Buffer.from(frameBuffer);
}

/**
 * Whether a real V2V backend is configured (e.g. V2V_SERVICE_URL). Currently always false (mock only).
 */
export function isV2VConfigured() {
  return !!(process.env.V2V_SERVICE_URL || process.env.V2V_ENABLED === 'true');
}
