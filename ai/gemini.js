// ═══════════════════════════════════════════════
// GEMINI 3.1 — Story Engine
// Narrates the world, maintains campaign memory,
// and generates prompts for image + music systems.
// ═══════════════════════════════════════════════

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

You must respond with ONLY valid JSON in this exact format:
{
  "narration": "Your 2-3 sentence narration here",
  "scene_prompt": "A detailed visual description for an image generator: fantasy illustration of [scene], dramatic lighting, cinematic composition, oil painting style",
  "music_mood": "one of: tavern, forest, battle, mystery, victory, danger, calm, epic",
  "characters_mentioned": ["list", "of", "character", "names"],
  "location": "current location name"
}`;

/**
 * Call Gemini to generate the next story beat.
 * @param {string} playerAction - What the player said/did
 * @param {number|null} diceRoll - d20 result (1-20) or null if no roll
 * @param {object} campaign - Full campaign history object
 * @returns {object} { narration, scene_prompt, music_mood, characters_mentioned, location }
 */
export async function generateStoryBeat(playerAction, diceRoll, campaign) {
  // Build context from campaign history
  const historyContext = buildHistoryContext(campaign);

  const userPrompt = [
    historyContext,
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
            maxOutputTokens: 500,
            responseMimeType: 'application/json',
          },
        }),
      });

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return JSON.parse(text);
      }
      const errMsg = data.error?.message || data.message || res.statusText || 'Unknown error';
      console.error('[GEMINI] API error:', res.status, errMsg);
      throw new Error(`Gemini API failed: ${errMsg}`);
    } catch (err) {
      if (err.message && err.message.startsWith('Gemini API')) throw err;
      console.error('[GEMINI] Request error:', err.message);
      throw new Error(`Gemini request failed: ${err.message}`);
    }
}

function buildHistoryContext(campaign) {
  const lines = ['CAMPAIGN HISTORY:'];

  if (campaign.characters.length > 0) {
    lines.push(`Characters: ${campaign.characters.map(c => `${c.name} (${c.role})`).join(', ')}`);
  }

  if (campaign.locations.length > 0) {
    lines.push(`Known locations: ${campaign.locations.join(', ')}`);
  }

  // Include last 8 events for context window efficiency
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
