import { generateBedtimeStoryBeat } from './gemini.js';
import { parseGeminiJson } from './parse_json.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const STORY_BLOCKLIST = [
  'kill',
  'killed',
  'murder',
  'blood',
  'weapon',
  'monster attack',
  'dead',
  'death',
  'corpse',
  'grave',
  'ghost attack',
  'terrified',
  'nightmare',
  'scream',
  'scary',
  'violence',
];

const SAFETY_RECHECK_PROMPT = `You are a safety checker for bedtime stories for young children.
Review the provided JSON fields and decide whether the content is safe.

Unsafe content includes any violence, fear, death, threatening language, horror, injury, or age-inappropriate material.

Respond with ONLY valid JSON:
{
  "safe": true,
  "reason": "short explanation"
}`;

/**
 * Generate a bedtime story beat and validate it before returning it to routes.
 * @param {string} playerAction
 * @param {object} campaign
 * @param {{ campaign_id: number, child_name: string, child_age: number, learning_goals: string[], story_energy: number }|null} [storySession]
 * @param {Array<{label: string, appearance: object}>} [sessionProfiles]
 * @param {string} [memoryContext] - Pre-summarized semantic memory from Chroma
 * @param {{ protagonist_description?: string, language?: string }} [options] - Optional overrides
 * @returns {Promise<object>}
 */
export async function generateSafeBedtimeStoryBeat(playerAction, campaign, storySession, sessionProfiles, memoryContext, options = {}) {
  const beat = await generateBedtimeStoryBeat(playerAction, campaign, storySession, sessionProfiles, memoryContext, options);
  await validateStoryContent(beat);
  return beat;
}

/**
 * Validate bedtime story content with a blocklist and optional Gemini re-check.
 * @param {{ narration?: string, scene_prompt?: string }} beat
 * @returns {Promise<void>}
 */
export async function validateStoryContent(beat) {
  const suspiciousTerms = getSuspiciousTerms(beat);
  if (suspiciousTerms.length === 0) return;

  const safe = await recheckStorySafety(beat, suspiciousTerms);
  if (!safe.safe) {
    throw new Error(`Story safety validation failed: ${safe.reason}`);
  }
}

/**
 * Ask Gemini for a second opinion when the blocklist finds suspicious terms.
 * @param {object} beat
 * @param {string[]} suspiciousTerms
 * @returns {Promise<{safe: boolean, reason: string}>}
 */
async function recheckStorySafety(beat, suspiciousTerms) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    return {
      safe: false,
      reason: `Blocked bedtime content because it matched: ${suspiciousTerms.join(', ')}`,
    };
  }

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SAFETY_RECHECK_PROMPT }] },
      contents: [{
        parts: [{
          text: JSON.stringify({
            suspiciousTerms,
            narration: beat.narration || '',
            scene_prompt: beat.scene_prompt || '',
          }),
        }],
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 128,
        responseMimeType: 'application/json',
      },
    }),
  });

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = text ? parseGeminiJson(text) : null;
  if (!parsed || typeof parsed.safe !== 'boolean') {
    return {
      safe: false,
      reason: `Blocked bedtime content because safety re-check was inconclusive (${suspiciousTerms.join(', ')})`,
    };
  }

  return {
    safe: parsed.safe,
    reason: parsed.reason || 'Safety re-check rejected the content',
  };
}

/**
 * Find blocklisted terms in narration or scene prompt.
 * @param {{ narration?: string, scene_prompt?: string }} beat
 * @returns {string[]}
 */
function getSuspiciousTerms(beat) {
  const haystack = `${beat.narration || ''}\n${beat.scene_prompt || ''}`.toLowerCase();
  return STORY_BLOCKLIST.filter((term) => haystack.includes(term));
}
