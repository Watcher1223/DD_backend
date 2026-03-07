// ═══════════════════════════════════════════════
// STAGE VISION — Detect new person in frame for character injection
// Compares current character analysis to previous state; returns new_entrant + description.
// ═══════════════════════════════════════════════

import { analyzeCharacters } from './character_analysis.js';

/**
 * Run character analysis and detect if a new person has entered the frame (e.g. judge walks in).
 * @param {string} frameBase64 - Base64 or data URL from webcam
 * @param {number} previousPeopleCount - Number of people seen in the last frame
 * @param {Set<string>} [previousLabels] - Optional set of labels (e.g. "child", "adult_1") already seen
 * @returns {Promise<{ people: Array<{label: string, hair?: string, clothing?: string, features?: string, age_range?: string}>, new_entrant: boolean, new_entrant_description?: string }>}
 */
export async function analyzeStageVision(frameBase64, previousPeopleCount = 0, previousLabels = null) {
  const analysis = await analyzeCharacters(frameBase64);
  const people = analysis.people || [];
  const prevLabels = previousLabels || new Set();

  const currentCount = people.length;
  const newEntrant = currentCount > previousPeopleCount;

  let new_entrant_description;
  if (newEntrant && people.length > 0) {
    const newPeople = previousPeopleCount < people.length
      ? people.slice(previousPeopleCount)
      : people;
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
