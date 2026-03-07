// ═══════════════════════════════════════════════
// FRAME UTILS — Shared webcam frame helpers
// Data URL parsing and MIME type detection for
// base64-encoded camera frames.
// ═══════════════════════════════════════════════

const DATA_URL_RE = /^data:(image\/[\w+]+);base64,/;

/**
 * Parse a base64 frame string, extracting the raw data and detecting the MIME type.
 * Handles both raw base64 and data URL prefixed strings.
 * @param {string} frameBase64 - Raw base64 or data URL string
 * @returns {{ data: string, mimeType: string }}
 */
export function parseFrame(frameBase64) {
  const match = frameBase64.match(DATA_URL_RE);
  if (match) {
    return {
      data: frameBase64.slice(match[0].length),
      mimeType: match[1],
    };
  }
  return {
    data: frameBase64,
    mimeType: 'image/jpeg',
  };
}
