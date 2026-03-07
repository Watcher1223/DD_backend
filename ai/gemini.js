// ═══════════════════════════════════════════════
// GEMINI 3.1 — Story Engine
// Narrates the world, maintains campaign memory,
// and generates prompts for image + music systems.
// ═══════════════════════════════════════════════

import { parseGeminiJson } from './parse_json.js';
import { THEME_KEYS } from './music_engine.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// System prompt that makes Gemini act as a D&D Dungeon Master
const SYSTEM_PROMPT = `You are a legendary Dungeon Master narrating a dark fantasy campaign.

RULES:
- Narrate in second person present tense ("You creep through the shadows...")
- Keep narrations to 2-3 vivid sentences maximum
- Factor in dice rolls: 1-5 = catastrophic fail, 6-10 = fail with silver lining, 11-15 = success, 16-19 = great success, 20 = legendary critical
- Reference previous events and characters from the campaign history
- Create dramatic tension and memorable moments
- Never break character

You must respond with ONLY valid JSON in this exact format (no markdown, no code fences; escape any quotes inside strings with \\ and no newlines inside string values):
{
  "narration": "Your 2-3 sentence narration here",
  "scene_prompt": "A detailed visual description for an image generator: fantasy illustration of [scene], dramatic lighting, cinematic composition, oil painting style",
  "music_mood": "one of: tavern, forest, battle, mystery, victory, danger, calm, epic",
  "characters_mentioned": ["list", "of", "character", "names"],
  "location": "current location name"
}`;

// Bedtime story: gentle narration + theme/mood/emotion for adaptive music
const BEDTIME_SYSTEM_PROMPT = `You are a gentle storyteller narrating a short bedtime story for a child.

RULES:
- Narrate in second person present tense ("You drift into a soft forest...")
- Keep each beat to 2-3 short, calming sentences
- Use soft, child-friendly imagery (magical forest, friendly animals, stars, dreams)
- No violence or fear
- Never break character

You must respond with ONLY valid JSON in this exact format (no markdown, no code fences; escape any quotes inside strings with \\ and no newlines inside string values):
{
  "narration": "Your 2-3 sentence calming narration here",
  "scene_prompt": "A detailed visual description for an image generator: gentle bedtime illustration of [scene], soft lighting, dreamy, child-friendly, watercolor style",
  "theme": "one of: magical forest, bedtime, under the sea, fairy tale, space adventure, calm, fantasy",
  "genre": "fantasy or lullaby",
  "mood": "one of: calm, peaceful, sleepy, gentle, dreamy",
  "intensity": 0.0 to 1.0 number (keep low for bedtime, e.g. 0.2 to 0.4)",
  "emotion": "one of: sleepy, calm, happy, peaceful, neutral, curious",
  "characters_mentioned": ["list", "of", "character", "names"],
  "location": "current location name"
}`;

/** Extract a single theme key from the user's spoken or typed description (e.g. "bedtime story in the forest" → "magical forest"). */
const THEME_EXTRACT_PROMPT = `The user will give a short description of the setting or theme they want for a bedtime story (e.g. "story in the forest", "under the sea", "space adventure").
Pick the ONE theme that best matches their description from this exact list (return only the theme string, no explanation):
${THEME_KEYS.map((t) => `- ${t}`).join('\n')}

Respond with ONLY valid JSON: { "theme": "<exactly one of the list above>" }
If unclear or generic (e.g. "a story"), use "bedtime".`;

/**
 * Extract theme key from user's voice or text description (e.g. "bedtime story with a theme in the forest" → "magical forest").
 * @param {string} description - User's phrase (transcribed from voice or typed)
 * @returns {Promise<string>} One of THEME_KEYS
 */
export async function extractThemeFromDescription(description) {
  if (!description || typeof description !== 'string') return 'bedtime';
  const trimmed = description.trim();
  if (!trimmed) return 'bedtime';

  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    return normalizeThemeFallback(trimmed);
  }

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: THEME_EXTRACT_PROMPT + '\n\nUser said: "' + trimmed + '"' }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 64,
          responseMimeType: 'application/json',
        },
      }),
    });
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      const parsed = parseGeminiJson(text);
      const theme = parsed?.theme && typeof parsed.theme === 'string' ? parsed.theme.trim().toLowerCase() : '';
      const matched = THEME_KEYS.find((k) => k.toLowerCase() === theme);
      if (matched) return matched;
      return normalizeThemeFallback(theme || trimmed);
    }
  } catch (err) {
    console.warn('[GEMINI] Theme extract failed:', err.message);
  }
  return normalizeThemeFallback(trimmed);
}

function normalizeThemeFallback(text) {
  const v = (text && String(text).toLowerCase()) || '';
  if (/forest|wood|tree|jungle/.test(v)) return 'magical forest';
  if (/sea|ocean|underwater|fish/.test(v)) return 'under the sea';
  if (/space|cosmic|star|moon|planet/.test(v)) return 'space adventure';
  if (/fairy|magic|enchanted/.test(v)) return 'fairy tale';
  if (/dragon|adventure|quest/.test(v)) return 'dragon adventure';
  if (/calm|peace|gentle/.test(v)) return 'calm';
  if (/fantasy/.test(v)) return 'fantasy';
  return 'bedtime';
}

/**
 * Generate a bedtime story beat (narration + theme signals for adaptive music).
 * @param {string} playerAction - What the listener said or what happens next
 * @param {object} campaign - Full campaign history object (same shape as DM)
 * @returns {object} { narration, scene_prompt, theme, genre, mood, intensity, emotion, characters_mentioned, location }
 */
export async function generateBedtimeStoryBeat(playerAction, campaign) {
  const historyContext = buildHistoryContext(campaign);

  const userPrompt = [
    historyContext,
    '',
    `NEXT: "${playerAction}"`,
    '',
    'Generate the next story beat as JSON.',
  ].join('\n');

  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    throw new Error('Gemini API key required. Set GEMINI_API_KEY in .env');
  }
  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: BEDTIME_SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
        },
      }),
    });

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      const parsed = parseGeminiJson(text);
      if (parsed) {
        if (!parsed.theme) parsed.theme = 'bedtime';
        if (!parsed.mood) parsed.mood = 'calm';
        if (parsed.intensity == null || Number.isNaN(Number(parsed.intensity))) parsed.intensity = 0.3;
        if (!parsed.emotion) parsed.emotion = 'neutral';
        return parsed;
      }
    }
    const errMsg = data.error?.message || data.message || res.statusText || 'Unknown error';
    throw new Error(`Gemini API failed: ${errMsg}`);
  } catch (err) {
    if (err.message?.startsWith('Gemini API') || err.message?.includes('invalid JSON')) throw err;
    console.error('[GEMINI] Bedtime request error:', err.message);
    throw new Error(`Gemini request failed: ${err.message}`);
  }
}

/**
 * Call Gemini to generate the next story beat.
 * @param {string} playerAction - What the player said/did
 * @param {number|null} diceRoll - d20 result (1-20) or null if no roll
 * @param {object} campaign - Full campaign history object
 * @param {Array<{label: string, appearance: object}>} [sessionProfiles] - Vision-extracted character appearances
 * @returns {object} { narration, scene_prompt, music_mood, characters_mentioned, location }
 */
export async function generateStoryBeat(playerAction, diceRoll, campaign, sessionProfiles) {
  const historyContext = buildHistoryContext(campaign);
  const appearanceContext = buildAppearanceContext(sessionProfiles);

  const userPrompt = [
    historyContext,
    appearanceContext,
    '',
    `PLAYER ACTION: "${playerAction}"`,
    diceRoll !== null ? `DICE ROLL (d20): ${diceRoll}` : 'NO DICE ROLL',
    '',
    'Generate the next story beat as JSON.',
  ].join('\n');

  // ── GEMINI API CALL (required; no mock) ──
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    throw new Error('Gemini API key required. Set GEMINI_API_KEY in .env (get one at https://aistudio.google.com/app/apikey).');
  }
  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
          },
        }),
      });

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const parsed = parseGeminiJson(text, STORY_BEAT_DEFAULTS);
        if (parsed) return parsed;
      }
      const errMsg = data.error?.message || data.message || res.statusText || 'Unknown error';
      console.error('[GEMINI] API error:', res.status, errMsg);
      throw new Error(`Gemini API failed: ${errMsg}`);
    } catch (err) {
      if (err.message && (err.message.startsWith('Gemini API') || err.message.includes('invalid JSON'))) throw err;
      console.error('[GEMINI] Request error:', err.message);
      throw new Error(`Gemini request failed: ${err.message}`);
    }
}

const STORY_BEAT_DEFAULTS = {
  scene_prompt: 'fantasy illustration, dramatic lighting, oil painting style',
  music_mood: 'calm',
  characters_mentioned: [],
  location: 'Unknown',
};

function buildHistoryContext(campaign) {
  const lines = ['CAMPAIGN HISTORY:'];

  if (campaign.characters.length > 0) {
    lines.push(`Characters: ${campaign.characters.map(c => `${c.name} (${c.role})`).join(', ')}`);
  }

  if (campaign.locations.length > 0) {
    lines.push(`Known locations: ${campaign.locations.join(', ')}`);
  }

  const recentEvents = campaign.events.slice(-8);
  if (recentEvents.length > 0) {
    lines.push('', 'RECENT EVENTS:');
    for (const evt of recentEvents) {
      lines.push(`- [${evt.location || 'unknown'}] ${evt.narration.slice(0, 120)}`);
    }
  }

  if (campaign.events.length === 0) {
    lines.push('', 'This is the OPENING SCENE. Set the stage for an epic adventure in a dark fantasy tavern.');
  }

  return lines.join('\n');
}

/**
 * Build a prompt section describing real character appearances from camera analysis.
 * Returns empty string if no profiles are available.
 * @param {Array<{label: string, appearance: object}>} [profiles]
 * @returns {string}
 */
function buildAppearanceContext(profiles) {
  if (!profiles || profiles.length === 0) return '';

  const lines = ['', 'CHARACTER APPEARANCES (from camera):'];
  for (const { label, appearance } of profiles) {
    const parts = [label];
    if (appearance.hair) parts.push(`hair: ${appearance.hair}`);
    if (appearance.clothing) parts.push(`clothing: ${appearance.clothing}`);
    if (appearance.features) parts.push(`features: ${appearance.features}`);
    if (appearance.age_range) parts.push(`age: ${appearance.age_range}`);
    lines.push(`- ${parts.join(', ')}`);
  }
  lines.push('Include these appearance details in the scene_prompt so generated images match the real people.');
  return lines.join('\n');
}
