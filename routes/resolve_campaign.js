// ═══════════════════════════════════════════════
// RESOLVE CAMPAIGN — Shared campaign ID resolution
// Used by multiple route files to extract and
// validate campaignId from requests.
// ═══════════════════════════════════════════════

import {
  getOrCreateDefaultCampaign,
  campaignExists,
} from '../db/index.js';

/**
 * Resolve campaignId from the request body or query string, falling back to the default campaign.
 * Returns null if the provided id doesn't exist.
 * @param {import('express').Request} req
 * @returns {number|null}
 */
export function resolveCampaignId(req) {
  const id = req.body?.campaignId ?? req.query?.campaignId;
  if (id != null) {
    const num = Number(id);
    if (Number.isNaN(num) || !campaignExists(num)) return null;
    return num;
  }
  return getOrCreateDefaultCampaign();
}
