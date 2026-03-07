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

const LANGUAGE_NAMES = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
};

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
/** Extract a single theme key from the user's spoken or typed description (e.g. "bedtime story in the forest" → "magical forest"). */
const THEME_EXTRACT_PROMPT = `The user will give a short description of the setting or theme they want for a bedtime story (e.g. "story in the forest", "under the sea", "space adventure").
Pick the ONE theme that best matches their description from this exact list (return only the theme string, no explanation):
${THEME_KEYS.map((t) => `- ${t}`).join('\n')}

Respond with ONLY valid JSON: { "theme": "<exactly one of the list above>" }
If unclear or generic (e.g. "a story"), use "bedtime".`;

/** Prompt for injecting a new character (e.g. judge) into the story when they appear on stage. */
const CHARACTER_INJECTION_PROMPT = `You are a gentle storyteller. A NEW PERSON has just appeared in the room during a live bedtime story. Describe their arrival in 1-2 short, calming sentences that weave them into the story as a friendly character (e.g. a wise traveler, a gentle guardian, a mysterious friend). Keep it child-friendly and warm.

Respond with ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "narration": "One or two sentences describing the new character's arrival in the story.",
  "scene_prompt": "A detailed visual description for an image generator: gentle bedtime illustration of [this character and the scene], soft lighting, dreamy, child-friendly, watercolor style"
}`;

/**
 * Generate a short story beat that introduces a new character (e.g. judge walking on stage).
 * @param {string} entrantDescription - Brief description of the new person (e.g. "adult with glasses, friendly expression")
 * @param {string} [currentStoryContext] - Optional current location or story context
 * @returns {Promise<{ narration: string, scene_prompt: string }>}
 */
export async function generateCharacterInjectionBeat(entrantDescription, currentStoryContext = '') {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    throw new Error('Gemini API key required. Set GEMINI_API_KEY in .env');
  }

  const userText = `The new person visible in the room: ${entrantDescription}.${currentStoryContext ? ` Current story setting: ${currentStoryContext}.` : ''}`;

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: CHARACTER_INJECTION_PROMPT + '\n\n' + userText }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
      },
    }),
  });

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const errMsg = data.error?.message || res.statusText || 'Unknown error';
    throw new Error(`Character injection failed: ${errMsg}`);
  }

  const parsed = parseGeminiJson(text);
  if (!parsed || !parsed.narration) {
    return {
      narration: `A wise traveler appeared at the edge of the camp, smiling gently.`,
      scene_prompt: 'Gentle bedtime illustration of a friendly traveler in soft lighting, dreamy, child-friendly, watercolor style',
    };
  }

  return {
    narration: String(parsed.narration).trim(),
    scene_prompt: parsed.scene_prompt ? String(parsed.scene_prompt).trim() : 'Gentle bedtime illustration, soft lighting, dreamy, child-friendly, watercolor style',
  };
}

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
      return normalizeThemeFallback(trimmed);
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
 * @param {{ campaign_id: number, child_name: string, child_age: number, learning_goals: string[], story_energy: number }|null} [storySession]
 * @param {Array<{label: string, appearance: object}>} [sessionProfiles]
 * @param {string} [memoryContext] - Pre-summarized semantic memory from Chroma
 * @param {{ protagonist_description?: string, language?: string }} [options] - Optional overrides
 * @returns {object} { narration, scene_prompt, theme, genre, mood, intensity, emotion, learning_moment, characters_mentioned, location, story_energy }
 */
export async function generateBedtimeStoryBeat(playerAction, campaign, storySession, sessionProfiles, memoryContext, options = {}) {
  const historyContext = buildBedtimeHistoryContext(campaign);
  const storySessionContext = buildStorySessionContext(storySession);
  const appearanceContext = buildAppearanceContext(sessionProfiles);
  const protagonist_description = options?.protagonist_description;
  const language = options?.language;

  const promptParts = [
    historyContext,
    storySessionContext,
    appearanceContext,
  ];
  if (memoryContext) promptParts.push(memoryContext);
  promptParts.push('', `NEXT: "${playerAction}"`, '', 'Generate the next story beat as JSON.');

  let userPrompt = promptParts.join('\n');

  if (language && LANGUAGE_NAMES[language]) {
    userPrompt = `Narrate in ${LANGUAGE_NAMES[language]}. All narration text must be in that language.\n\n` + userPrompt;
  }

  if (protagonist_description && String(protagonist_description).trim()) {
    userPrompt = `The hero of the story is: ${String(protagonist_description).trim()}. Describe scenes with this character as the main focus. Keep the same JSON format.\n\n` + userPrompt;
  }

  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    throw new Error('Gemini API key required. Set GEMINI_API_KEY in .env');
  }
  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildBedtimeSystemPrompt(storySession) }] },
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
      const parsed = parseGeminiJson(text, BEDTIME_BEAT_DEFAULTS);
      if (parsed) {
        if (!parsed.theme) parsed.theme = 'bedtime';
        if (!parsed.mood) parsed.mood = 'calm';
        parsed.intensity = clampBedtimeIntensity(parsed.intensity);
        if (!parsed.emotion) parsed.emotion = 'neutral';
        if (!parsed.learning_moment) {
          parsed.learning_moment = storySession?.learning_goals?.[0] || 'gentle bedtime routine';
        }
        parsed.story_energy = getNextStoryEnergy(storySession?.story_energy);
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

const BEDTIME_BEAT_DEFAULTS = {
  scene_prompt: 'gentle bedtime illustration, soft lighting, dreamy watercolor style',
  theme: 'bedtime',
  genre: 'lullaby',
  mood: 'calm',
  intensity: 0.3,
  emotion: 'sleepy',
  learning_moment: 'gentle bedtime routine',
  characters_mentioned: [],
  location: 'Dream Meadow',
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
 * Build a bedtime-story history section with a softer opening scene.
 * @param {{ characters: Array<{name: string, role: string}>, locations: string[], events: Array<{location?: string, narration: string}> }} campaign
 * @returns {string}
 */
function buildBedtimeHistoryContext(campaign) {
  const lines = ['BEDTIME STORY HISTORY:'];

  if (campaign.characters.length > 0) {
    lines.push(`Helpful story friends: ${campaign.characters.map((c) => `${c.name} (${c.role})`).join(', ')}`);
  }

  if (campaign.locations.length > 0) {
    lines.push(`Dreamy places so far: ${campaign.locations.join(', ')}`);
  }

  const recentEvents = campaign.events.slice(-8);
  if (recentEvents.length > 0) {
    lines.push('', 'RECENT STORY BEATS:');
    for (const evt of recentEvents) {
      lines.push(`- [${evt.location || 'unknown'}] ${evt.narration.slice(0, 120)}`);
    }
  }

  if (campaign.events.length === 0) {
    lines.push('', 'This is the opening bedtime scene. Begin somewhere cozy, magical, and immediately soothing.');
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
    if (appearance.fantasy_name) parts.push(`storybook name: ${appearance.fantasy_name}`);
    if (appearance.character_description) parts.push(`storybook description: ${appearance.character_description}`);
    if (appearance.hair) parts.push(`hair: ${appearance.hair}`);
    if (appearance.clothing) parts.push(`clothing: ${appearance.clothing}`);
    if (appearance.features) parts.push(`features: ${appearance.features}`);
    if (appearance.age_range) parts.push(`age: ${appearance.age_range}`);
    lines.push(`- ${parts.join(', ')}`);
  }
  lines.push('Include these appearance details in the scene_prompt so generated images match the real people.');
  return lines.join('\n');
}

/**
 * Build the bedtime-specific system prompt with child/session context.
 * @param {{ child_name: string, child_age: number, learning_goals: string[], story_energy: number }|null} storySession
 * @returns {string}
 */
function buildBedtimeSystemPrompt(storySession) {
  const childName = storySession?.child_name || 'the child';
  const childAge = storySession?.child_age ?? 'unknown';
  const learningGoals = formatLearningGoals(storySession?.learning_goals);
  const storyEnergy = formatStoryEnergy(storySession?.story_energy);

  return `You are a gentle storyteller narrating a short bedtime story for a child.

RULES:
- Narrate in second person present tense, but use the child's name "${childName}" naturally instead of only saying "you"
- Keep each beat to 2-3 short, calming sentences
- Use vocabulary appropriate for a child around age ${childAge}
- Weave these learning goals into the beat naturally when possible: ${learningGoals}
- The current wind-down level is ${storyEnergy}. As energy decreases, make the pacing softer, the sentences shorter, and the imagery sleepier
- Use soft, child-friendly imagery such as friendly animals, stars, dreams, gentle magic, and comforting routines
- Never include violence, fear, death, peril, threats, or anything inappropriate for a child
- Never break character

You must respond with ONLY valid JSON in this exact format (no markdown, no code fences; escape any quotes inside strings with \\ and no newlines inside string values):
{
  "narration": "Your 2-3 sentence calming narration here",
  "scene_prompt": "A detailed visual description for an image generator: gentle bedtime illustration of [scene], soft lighting, dreamy, child-friendly, watercolor style",
  "theme": "one of: magical forest, bedtime, under the sea, fairy tale, space adventure, calm, fantasy",
  "genre": "fantasy or lullaby",
  "mood": "one of: calm, peaceful, sleepy, gentle, dreamy",
  "intensity": 0.0 to 1.0 number (keep low for bedtime, e.g. 0.1 to 0.4)",
  "emotion": "one of: sleepy, calm, happy, peaceful, neutral, curious",
  "learning_moment": "Short phrase naming the educational concept used in this beat",
  "characters_mentioned": ["list", "of", "character", "names"],
  "location": "current location name"
}`;
}

/**
 * Build prompt context for the bedtime session configuration.
 * @param {{ child_name: string, child_age: number, learning_goals: string[], story_energy: number }|null} storySession
 * @returns {string}
 */
function buildStorySessionContext(storySession) {
  if (!storySession) {
    return [
      '',
      'STORY SESSION:',
      '- No custom child profile has been configured yet.',
      '- Keep the narration broadly child-friendly and bedtime-focused.',
    ].join('\n');
  }

  return [
    '',
    'STORY SESSION:',
    `- Child name: ${storySession.child_name}`,
    `- Child age: ${storySession.child_age}`,
    `- Learning goals: ${formatLearningGoals(storySession.learning_goals)}`,
    `- Current story energy: ${formatStoryEnergy(storySession.story_energy)}`,
  ].join('\n');
}

/**
 * Compute the next bedtime story energy after one beat.
 * @param {number|undefined} storyEnergy
 * @returns {number}
 */
function getNextStoryEnergy(storyEnergy) {
  const current = Number.isFinite(Number(storyEnergy)) ? Number(storyEnergy) : 1.0;
  return Math.max(0, Math.min(1, current - 0.15));
}

/**
 * Clamp bedtime intensity into the desired low-energy range.
 * @param {number} intensity
 * @returns {number}
 */
function clampBedtimeIntensity(intensity) {
  const numeric = Number(intensity);
  if (Number.isNaN(numeric)) return 0.3;
  return Math.max(0.05, Math.min(0.4, numeric));
}

/**
 * Format learning goals for prompt injection.
 * @param {string[]|undefined} learningGoals
 * @returns {string}
 */
function formatLearningGoals(learningGoals) {
  if (!Array.isArray(learningGoals) || learningGoals.length === 0) {
    return 'gentle bedtime calm, kindness, and imagination';
  }
  return learningGoals.join(', ');
}

/**
 * Format story energy for prompt injection.
 * @param {number|undefined} storyEnergy
 * @returns {string}
 */
function formatStoryEnergy(storyEnergy) {
  const numeric = Number(storyEnergy);
  if (Number.isNaN(numeric)) return '1.00';
  return Math.max(0, Math.min(1, numeric)).toFixed(2);
}
