// ═══════════════════════════════════════════════
// FRAME UTILS — Shared webcam frame helpers
// Data URL parsing and MIME type detection for
// base64-encoded camera frames.
// ═══════════════════════════════════════════════

const DATA_URL_RE = /^data:(image\/[\w+]+);base64,/;
const MIN_BASE64_LENGTH = 200;

/**
 * Parse a base64 frame string, extracting the raw data and detecting the MIME type.
 * Handles both raw base64 and data URL prefixed strings.
 * Throws if the frame is empty or too small to be a real image.
 * @param {string} frameBase64 - Raw base64 or data URL string
 * @returns {{ data: string, mimeType: string }}
 */
export function parseFrame(frameBase64) {
  if (!frameBase64 || frameBase64 === 'data:,' || frameBase64 === 'data:;base64,') {
    throw new Error('Empty frame: camera may not be ready. Wait for the video stream to produce pixels before capturing.');
  }

  const match = frameBase64.match(DATA_URL_RE);
  if (match) {
    const data = frameBase64.slice(match[0].length);
    if (data.length < MIN_BASE64_LENGTH) {
      throw new Error('Frame too small to be a valid image. Ensure the camera is active and the canvas has drawn a frame.');
    }
    return { data, mimeType: match[1] };
  }

  if (frameBase64.length < MIN_BASE64_LENGTH) {
    throw new Error('Frame too small to be a valid image. Ensure the camera is active and the canvas has drawn a frame.');
  }
  return {
    data: frameBase64,
    mimeType: 'image/jpeg',
  };
}
