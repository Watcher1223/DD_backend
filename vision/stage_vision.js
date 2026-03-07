// ═══════════════════════════════════════════════
// STAGE VISION — Detect new person in frame for character injection
// Compares current character analysis to previous state; returns new_entrant + description.
// ═══════════════════════════════════════════════

import { analyzeCharacters } from './character_analysis.js';

/**
 * Run character analysis on a raw frame and detect if a new person has entered.
 * Makes a Gemini Vision API call. Prefer {@link detectNewEntrant} when you already
 * have analysis results from a prior call to avoid a duplicate API request.
 * @param {string} frameBase64 - Base64 or data URL from webcam
 * @param {number} previousPeopleCount - Number of people seen in the last frame
 * @param {Set<string>} [previousLabels] - Optional set of labels (e.g. "child", "adult_1") already seen
 * @returns {Promise<{ people: Array, new_entrant: boolean, new_entrant_description?: string, setting?: string }>}
 */
export async function analyzeStageVision(frameBase64, previousPeopleCount = 0, previousLabels = null) {
  const analysis = await analyzeCharacters(frameBase64);
  return detectNewEntrant(analysis, previousPeopleCount, previousLabels);
}

/**
 * Detect if a new person entered the frame using pre-computed analysis results.
 * No Gemini call — reuses the analysis already fetched by camera/analyze.
 * @param {{ people: Array, setting?: string }} analysis - Result from analyzeCharacters
 * @param {number} previousPeopleCount - Number of people seen in the last frame
 * @param {Set<string>} [previousLabels] - Optional set of labels already seen
 * @returns {{ people: Array, new_entrant: boolean, new_entrant_description?: string, setting?: string }}
 */
export function detectNewEntrant(analysis, previousPeopleCount = 0, previousLabels = null) {
  const people = analysis.people || [];
  const prevLabels = previousLabels || new Set();

  const newEntrant = people.length > previousPeopleCount;

  let new_entrant_description;
  if (newEntrant && people.length > 0) {
    const newPeople = people.slice(previousPeopleCount);
    const descParts = newPeople.map((p) => {
      const parts = [p.label || 'person'];
      if (p.age_range) parts.push(p.age_range);
      if (p.features) parts.push(p.features);
      if (p.clothing) parts.push(p.clothing);
      if (p.hair) parts.push(p.hair);
      return parts.join(', ');
    });
    new_entrant_description = descParts.join('; ') || 'A new person appeared.';
  }

  return {
    people,
    new_entrant: newEntrant,
    new_entrant_description,
    setting: analysis.setting,
  };
}
