// ═══════════════════════════════════════════════
// GEMINI 3.1 — Story Engine
// Narrates the world, maintains campaign memory,
// and generates prompts for image + music systems.
// ═══════════════════════════════════════════════

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

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

  // ── GEMINI API CALL ──
  if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here') {
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
    } catch (err) {
      console.error('[GEMINI] API error, falling back to mock:', err.message);
    }
  }

  // ── MOCK FALLBACK ──
  return generateMockBeat(playerAction, diceRoll);
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

// Convincing mock responses for demo without API key
function generateMockBeat(playerAction, diceRoll) {
  const actionLower = playerAction.toLowerCase();
  const roll = diceRoll || Math.floor(Math.random() * 20) + 1;

  const scenarios = [
    {
      keywords: ['attack', 'fight', 'strike', 'slash', 'hit', 'sword'],
      success: {
        narration: 'Your blade arcs through the torchlight, finding the gap between the creature\'s armored plates. Black ichor sprays across the stone floor as it staggers backward, letting out a shriek that echoes through the dungeon.',
        scene_prompt: 'Fantasy illustration of a warrior striking a dark armored creature in a torch-lit dungeon, black blood spraying, dramatic lighting, cinematic composition, oil painting style, dark fantasy',
        music_mood: 'battle',
      },
      fail: {
        narration: 'Your swing goes wide, the blade sparking against the stone wall. The creature\'s eyes flash with predatory intelligence as it lunges forward, forcing you to scramble backward over the rubble.',
        scene_prompt: 'Fantasy illustration of a warrior stumbling backward as a dark creature lunges in a dungeon corridor, torches flickering, desperate atmosphere, oil painting style, dark fantasy',
        music_mood: 'danger',
      },
    },
    {
      keywords: ['sneak', 'stealth', 'hide', 'creep', 'quiet', 'shadow'],
      success: {
        narration: 'You melt into the shadows like smoke, your footsteps silent on the cold stone. The guards pass within arm\'s reach, their torchlight sliding over you without purchase. The vault door gleams ahead, unguarded.',
        scene_prompt: 'Fantasy illustration of a rogue hiding in deep shadows of a castle corridor, guards passing with torches, moonlight through window, stealth atmosphere, oil painting style, dark fantasy',
        music_mood: 'mystery',
      },
      fail: {
        narration: 'A loose flagstone shifts under your boot with a grinding screech. Two guards whip around, crossbows leveled at your chest. "Don\'t move," the captain growls, steel in his voice.',
        scene_prompt: 'Fantasy illustration of guards discovering a thief in a castle corridor, crossbows aimed, torch-lit tension, dramatic confrontation, oil painting style, dark fantasy',
        music_mood: 'danger',
      },
    },
    {
      keywords: ['talk', 'speak', 'persuade', 'convince', 'ask', 'negotiate'],
      success: {
        narration: 'Your words weave through the air like an enchantment. The merchant\'s suspicious scowl slowly melts into a grudging smile. "Fine," he sighs, sliding a leather-wrapped bundle across the counter. "But you owe me a favor, adventurer."',
        scene_prompt: 'Fantasy illustration of a charismatic adventurer negotiating with a grizzled merchant in a candlelit shop full of magical artifacts, warm atmosphere, oil painting style, dark fantasy',
        music_mood: 'tavern',
      },
      fail: {
        narration: 'The merchant\'s expression hardens like cooling iron. "I know a liar when I see one," he spits, reaching beneath the counter. You hear the unmistakable click of a loaded crossbow. "Get out of my shop."',
        scene_prompt: 'Fantasy illustration of an angry merchant aiming a crossbow at an adventurer in a dark magical shop, threatening atmosphere, candlelight, oil painting style, dark fantasy',
        music_mood: 'danger',
      },
    },
    {
      keywords: ['look', 'search', 'examine', 'investigate', 'explore', 'check'],
      success: {
        narration: 'Your keen eyes catch what others would miss — a faint sigil carved into the wall, pulsing with residual magic. As your fingers trace its curves, a hidden compartment clicks open, revealing a scroll wrapped in dragon leather.',
        scene_prompt: 'Fantasy illustration of an adventurer discovering a glowing magical sigil on a dungeon wall, hidden compartment opening, mystical blue light, oil painting style, dark fantasy',
        music_mood: 'mystery',
      },
      fail: {
        narration: 'You search every crack and crevice but find nothing except dust and old cobwebs. Then you hear it — a low, wet breathing from somewhere in the darkness behind you. You are not alone.',
        scene_prompt: 'Fantasy illustration of an adventurer searching a dark chamber with a torch, ominous shadows gathering behind them, something watching from darkness, oil painting style, dark fantasy',
        music_mood: 'danger',
      },
    },
  ];

  // Find matching scenario or use a default
  let scenario = scenarios.find(s => s.keywords.some(k => actionLower.includes(k)));
  if (!scenario) {
    scenario = {
      keywords: [],
      success: {
        narration: 'Fortune favors the bold. Your action succeeds beyond expectation — the world bends to your will, and new paths unfold before you like a map drawn in starlight.',
        scene_prompt: 'Fantasy illustration of a heroic adventurer standing triumphant in a mystical landscape, golden light breaking through storm clouds, epic atmosphere, oil painting style, dark fantasy',
        music_mood: 'epic',
      },
      fail: {
        narration: 'The fates are cruel today. Your attempt falters, and the consequences ripple outward like stones cast into dark water. Something stirs in the shadows, drawn by the commotion.',
        scene_prompt: 'Fantasy illustration of a weary adventurer in a dark mystical landscape, ominous shadows gathering, storm clouds overhead, foreboding atmosphere, oil painting style, dark fantasy',
        music_mood: 'danger',
      },
    };
  }

  const isSuccess = roll >= 11;
  const result = isSuccess ? scenario.success : scenario.fail;

  // Add critical hit/fail flavor
  let narration = result.narration;
  if (roll === 20) {
    narration = '★ CRITICAL SUCCESS! ★ ' + narration + ' The gods themselves seem to smile upon your action.';
  } else if (roll === 1) {
    narration = '✗ CRITICAL FAILURE! ✗ ' + narration + ' Could this day get any worse?';
  }

  return {
    narration,
    scene_prompt: result.scene_prompt,
    music_mood: result.music_mood,
    characters_mentioned: [],
    location: 'The Obsidian Depths',
  };
}
