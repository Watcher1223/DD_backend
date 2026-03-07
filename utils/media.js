// ═══════════════════════════════════════════════
// MEDIA UTILS — Shared media data URL helpers
// Parses base64-encoded image and audio data,
// detects MIME types, and validates payloads.
// ═══════════════════════════════════════════════

const DATA_URL_RE = /^data:((?:image|audio)\/[\w.+-]+);base64,/;
const MIN_IMAGE_BASE64 = 200;
const MIN_AUDIO_BASE64 = 100;

/**
 * Parse a base64 media string, extracting the raw data and detecting the MIME type.
 * Handles both raw base64 and data URL prefixed strings.
 * Throws if the payload is empty or too small to be valid.
 * @param {string} base64Input - Raw base64 or data URL string
 * @param {'image'|'audio'} kind - What type of media to expect (used for defaults and error messages)
 * @returns {{ data: string, mimeType: string }}
 */
export function parseMedia(base64Input, kind = 'image') {
  if (!base64Input || base64Input === 'data:,' || base64Input === 'data:;base64,') {
    const hint = kind === 'image'
      ? 'Empty frame: camera may not be ready. Wait for the video stream to produce pixels before capturing.'
      : 'Empty audio: recording may not have captured any data.';
    throw new Error(hint);
  }

  const match = base64Input.match(DATA_URL_RE);
  const minLength = kind === 'audio' ? MIN_AUDIO_BASE64 : MIN_IMAGE_BASE64;

  if (match) {
    const data = base64Input.slice(match[0].length);
    if (data.length < minLength) {
      throw new Error(`${kind} payload too small to be valid (${data.length} chars).`);
    }
    return { data, mimeType: match[1] };
  }

  if (base64Input.length < minLength) {
    throw new Error(`${kind} payload too small to be valid (${base64Input.length} chars).`);
  }

  const defaultMime = kind === 'audio' ? 'audio/webm' : 'image/jpeg';
  return { data: base64Input, mimeType: defaultMime };
}

/**
 * Convenience wrapper for image frames. Calls parseMedia with kind='image'.
 * @param {string} frameBase64
 * @returns {{ data: string, mimeType: string }}
 */
export function parseFrame(frameBase64) {
  return parseMedia(frameBase64, 'image');
}

/**
 * Convenience wrapper for audio blobs. Calls parseMedia with kind='audio'.
 * @param {string} audioBase64
 * @returns {{ data: string, mimeType: string }}
 */
export function parseAudio(audioBase64) {
  return parseMedia(audioBase64, 'audio');
}
