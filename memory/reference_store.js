// ═══════════════════════════════════════════════
// REFERENCE STORE — In-memory subject reference
// images for Imagen 3 Customization.
// Stores up to MAX_FRAMES camera frames per
// campaign so generated images preserve the
// user's actual likeness.
// ═══════════════════════════════════════════════

const MAX_FRAMES = 4;

/** @type {Map<number, Array<{ data: string, mimeType: string, subjectDescription: string }>>} */
const store = new Map();

/** @type {Map<number, string>} Canonical (merged) subject description per campaign */
const canonicalDescriptions = new Map();

/**
 * Add a reference frame captured from the camera.
 * Keeps the most recent MAX_FRAMES per campaign.
 * @param {number} campaignId
 * @param {string} rawBase64 - Raw base64 image data (no data-URL prefix)
 * @param {string} mimeType - e.g. "image/jpeg"
 * @param {string} subjectDescription - Short text description of the person for Imagen's subjectDescription field
 */
export function addReferenceFrame(campaignId, rawBase64, mimeType, subjectDescription) {
  if (!store.has(campaignId)) store.set(campaignId, []);
  const frames = store.get(campaignId);

  if (frames.length >= MAX_FRAMES) frames.shift();
  frames.push({ data: rawBase64, mimeType, subjectDescription });

  console.log(`[REF_STORE] Campaign ${campaignId}: ${frames.length}/${MAX_FRAMES} reference frame(s)`);
}

/**
 * Get all stored reference frames for a campaign.
 * @param {number} campaignId
 * @returns {Array<{ data: string, mimeType: string, subjectDescription: string }>}
 */
export function getReferenceFrames(campaignId) {
  return store.get(campaignId) ?? [];
}

/**
 * Whether at least one reference frame exists for a campaign.
 * @param {number} campaignId
 * @returns {boolean}
 */
export function hasReferenceFrames(campaignId) {
  return (store.get(campaignId)?.length ?? 0) > 0;
}

/**
 * Set or merge the canonical subject description for a campaign.
 * Keeps the longer (richer) description when merging.
 * @param {number} campaignId
 * @param {string} description
 */
export function setCanonicalDescription(campaignId, description) {
  const existing = canonicalDescriptions.get(campaignId);
  if (!existing || description.length > existing.length) {
    canonicalDescriptions.set(campaignId, description);
    console.log(`[REF_STORE] Canonical description updated for campaign ${campaignId}: "${description}"`);
  }
}

/**
 * Get the canonical subject description for a campaign.
 * @param {number} campaignId
 * @returns {string|undefined}
 */
export function getCanonicalDescription(campaignId) {
  return canonicalDescriptions.get(campaignId);
}

/**
 * Clear all reference frames and canonical description for a campaign (e.g. on reset).
 * @param {number} campaignId
 */
export function clearReferenceFrames(campaignId) {
  store.delete(campaignId);
  canonicalDescriptions.delete(campaignId);
}
