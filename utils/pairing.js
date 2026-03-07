// ═══════════════════════════════════════════════
// PAIRING — In-memory pairing code store
// Links short codes to campaign IDs so a phone
// can send camera frames without knowing the
// campaign. Codes expire after a configurable TTL.
// ═══════════════════════════════════════════════

const PAIRING_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CODE_LENGTH = 6;
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion

const pairings = new Map();

/**
 * Generate a random pairing code.
 */
function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

/**
 * Create a pairing code linked to a campaign ID.
 * If one already exists for this campaign, return the existing code.
 * @param {number} campaignId
 * @returns {{ code: string, expiresAt: number }}
 */
export function createPairing(campaignId) {
  for (const [code, entry] of pairings) {
    if (entry.campaignId === campaignId && entry.expiresAt > Date.now()) {
      return { code, expiresAt: entry.expiresAt };
    }
  }

  let code;
  do {
    code = generateCode();
  } while (pairings.has(code));

  const expiresAt = Date.now() + PAIRING_TTL_MS;
  pairings.set(code, { campaignId, expiresAt });
  return { code, expiresAt };
}

/**
 * Resolve a pairing code to a campaign ID.
 * Returns null if the code is invalid or expired.
 * @param {string} code
 * @returns {number|null}
 */
export function resolvePairing(code) {
  const entry = pairings.get(code?.toUpperCase());
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    pairings.delete(code.toUpperCase());
    return null;
  }
  return entry.campaignId;
}

/**
 * Remove expired pairings. Called lazily -- no interval timer needed for a hackathon.
 */
export function pruneExpired() {
  const now = Date.now();
  for (const [code, entry] of pairings) {
    if (entry.expiresAt < now) pairings.delete(code);
  }
}
