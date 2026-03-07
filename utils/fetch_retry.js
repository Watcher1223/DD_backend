// ═══════════════════════════════════════════════
// FETCH RETRY — Automatic backoff for rate limits
// Wraps fetch() with exponential retry on 429
// responses, using the server's Retry-After header
// when available.
// ═══════════════════════════════════════════════

const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;

/**
 * Fetch with automatic retry on 429 (rate limit) responses.
 * Uses the Retry-After header when present, otherwise exponential backoff.
 * @param {string} url
 * @param {RequestInit} options
 * @param {{ maxRetries?: number, label?: string }} [retryOpts]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options, retryOpts = {}) {
  const maxRetries = retryOpts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const label = retryOpts.label || 'FETCH';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429 || attempt === maxRetries) return res;

    const delayMs = parseRetryDelay(res) || backoffDelay(attempt);
    console.warn(`[${label}] Rate limited (429), retrying in ${(delayMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})`);
    await sleep(delayMs);
  }
}

/**
 * Parse the Retry-After header or the retry delay embedded in the error body.
 * Returns milliseconds to wait, or 0 if not parseable.
 * @param {Response} res
 * @returns {number}
 */
function parseRetryDelay(res) {
  const header = res.headers.get('Retry-After');
  if (header) {
    const secs = parseFloat(header);
    if (!isNaN(secs) && secs > 0) return Math.min(secs * 1000, MAX_DELAY_MS);
  }
  return 0;
}

/**
 * Exponential backoff: 2s, 4s, 8s, ... capped at MAX_DELAY_MS.
 * Adds jitter (±25%) to avoid thundering herd.
 * @param {number} attempt - Zero-based attempt index
 * @returns {number}
 */
function backoffDelay(attempt) {
  const base = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jitter = base * (0.75 + Math.random() * 0.5);
  return Math.round(jitter);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
