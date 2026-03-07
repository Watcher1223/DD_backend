// ═══════════════════════════════════════════════
// CHROMA — Semantic memory layer
// Optional sidecar for character consistency,
// story-scene recall, and prompt enrichment.
// SQLite remains the source of truth; Chroma is
// a derived semantic index that can be unavailable
// without breaking the core pipeline.
// ═══════════════════════════════════════════════

import { ChromaClient } from 'chromadb';

const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';
const COLLECTION_PREFIX = process.env.CHROMA_COLLECTION_PREFIX || 'lw';
const TOP_K = parseInt(process.env.CHROMA_TOP_K || '5', 10);

let client = null;
let appearanceCollection = null;
let storyCollection = null;
let enabled = false;

// ── Public API ──────────────────────────────────

/**
 * Initialize the Chroma client and collections.
 * Non-fatal: logs a warning and disables semantic memory if Chroma is unreachable.
 */
export async function initChroma() {
  if (process.env.CHROMA_ENABLED === 'false') {
    console.log('[CHROMA] Disabled via CHROMA_ENABLED=false');
    return;
  }

  try {
    client = new ChromaClient({ path: CHROMA_URL });
    await client.heartbeat();

    appearanceCollection = await client.getOrCreateCollection({
      name: `${COLLECTION_PREFIX}_appearance`,
    });
    storyCollection = await client.getOrCreateCollection({
      name: `${COLLECTION_PREFIX}_story`,
    });

    enabled = true;
    console.log('[CHROMA] Connected — semantic memory enabled');
  } catch (err) {
    console.warn('[CHROMA] Unavailable — running without semantic memory:', err.message);
    enabled = false;
  }
}

/**
 * Whether Chroma is connected and collections are ready.
 * @returns {boolean}
 */
export function isChromaEnabled() {
  return enabled;
}

// ── Appearance Memory ───────────────────────────

/**
 * Upsert a canonical appearance record for a detected person.
 * Merges observation count so repeated scans stabilize the record.
 * @param {number} campaignId
 * @param {{ label: string, fantasy_name?: string, character_description?: string, hair?: string, clothing?: string, features?: string, age_range?: string }} person
 * @param {string} [setting] - Environment description from the camera frame
 */
export async function upsertAppearanceMemory(campaignId, person, setting) {
  if (!enabled) return;
  try {
    const docId = `appearance_${campaignId}_${person.label}`;
    const existing = await safeGet(appearanceCollection, docId);
    const observationCount = (existing?.metadatas?.[0]?.observationCount ?? 0) + 1;

    const documentText = buildAppearanceDocument(person, setting);

    await appearanceCollection.upsert({
      ids: [docId],
      documents: [documentText],
      metadatas: [{
        type: 'appearance',
        campaignId,
        label: person.label,
        fantasyName: person.fantasy_name || '',
        updatedAt: Date.now(),
        source: 'camera',
        observationCount,
      }],
    });
  } catch (err) {
    console.warn('[CHROMA] Appearance upsert failed:', err.message);
  }
}

/**
 * Retrieve canonical appearance memories for a campaign.
 * @param {number} campaignId
 * @param {number} [limit]
 * @returns {Promise<Array<{ id: string, document: string, metadata: object }>>}
 */
export async function getAppearanceMemories(campaignId, limit = TOP_K) {
  if (!enabled) return [];
  try {
    const results = await appearanceCollection.get({
      where: { campaignId },
      limit,
    });
    return zipResults(results);
  } catch (err) {
    console.warn('[CHROMA] Appearance retrieval failed:', err.message);
    return [];
  }
}

// ── Story Scene Memory ──────────────────────────

/**
 * Upsert a story-scene memory document from a saved beat.
 * @param {number} campaignId
 * @param {{ action: string, narration: string, scene_prompt: string, location: string, theme?: string, mood?: string, emotion?: string, learningMoment?: string, imageUrl?: string, timestamp: number }} event
 */
export async function upsertStoryMemory(campaignId, event) {
  if (!enabled) return;
  try {
    const docId = `story_${campaignId}_${event.timestamp}`;
    const documentText = buildStoryDocument(event);

    await storyCollection.upsert({
      ids: [docId],
      documents: [documentText],
      metadatas: [{
        type: 'story_scene',
        campaignId,
        timestamp: event.timestamp,
        eventKind: 'story',
        location: event.location || '',
        theme: event.theme || '',
        mood: event.mood || '',
      }],
    });
  } catch (err) {
    console.warn('[CHROMA] Story memory upsert failed:', err.message);
  }
}

/**
 * Retrieve story-scene memories semantically related to a query.
 * Uses hybrid approach: metadata filter by campaignId, then semantic similarity.
 * @param {number} campaignId
 * @param {string} queryText - The current action or scene description to match against
 * @param {number} [limit]
 * @returns {Promise<Array<{ id: string, document: string, metadata: object, distance: number }>>}
 */
export async function queryStoryMemories(campaignId, queryText, limit = TOP_K) {
  if (!enabled) return [];
  try {
    const results = await storyCollection.query({
      queryTexts: [queryText],
      nResults: limit,
      where: { campaignId },
    });
    return zipQueryResults(results);
  } catch (err) {
    console.warn('[CHROMA] Story query failed:', err.message);
    return [];
  }
}

// ── Retrieval + Summarization ───────────────────

/**
 * Retrieve and summarize all relevant memories for a bedtime story beat.
 * Returns a compact prompt-ready text block, or empty string if nothing useful is found.
 * @param {number} campaignId
 * @param {string} action - The player/listener action triggering the beat
 * @returns {Promise<string>}
 */
export async function retrieveMemoryContext(campaignId, action) {
  if (!enabled) return '';

  const [appearances, scenes] = await Promise.all([
    getAppearanceMemories(campaignId, 3),
    queryStoryMemories(campaignId, action, 4),
  ]);

  if (appearances.length === 0 && scenes.length === 0) return '';

  return summarizeMemories(appearances, scenes);
}

// ── Helpers ─────────────────────────────────────

/**
 * Build the document text for an appearance memory record.
 * @param {object} person
 * @param {string} [setting]
 * @returns {string}
 */
function buildAppearanceDocument(person, setting) {
  const parts = [];
  if (person.label) parts.push(`Role: ${person.label}`);
  if (person.fantasy_name) parts.push(`Storybook name: ${person.fantasy_name}`);
  if (person.character_description) parts.push(`Description: ${person.character_description}`);
  if (person.hair) parts.push(`Hair: ${person.hair}`);
  if (person.clothing) parts.push(`Clothing: ${person.clothing}`);
  if (person.features) parts.push(`Features: ${person.features}`);
  if (person.age_range) parts.push(`Age: ${person.age_range}`);
  if (setting) parts.push(`Environment: ${setting}`);
  return parts.join('. ');
}

/**
 * Build the document text for a story-scene memory record.
 * @param {object} event
 * @returns {string}
 */
function buildStoryDocument(event) {
  const parts = [];
  if (event.action) parts.push(`Action: ${event.action}`);
  if (event.narration) parts.push(`Narration: ${event.narration}`);
  if (event.scene_prompt) parts.push(`Scene: ${event.scene_prompt}`);
  if (event.location) parts.push(`Location: ${event.location}`);
  if (event.theme) parts.push(`Theme: ${event.theme}`);
  if (event.mood) parts.push(`Mood: ${event.mood}`);
  if (event.emotion) parts.push(`Emotion: ${event.emotion}`);
  if (event.learningMoment) parts.push(`Learning: ${event.learningMoment}`);
  return parts.join('. ');
}

/**
 * Summarize retrieved memories into a compact prompt-safe string.
 * Keeps context small: canonical appearance first, then 1-2 relevant prior scenes.
 * @param {Array<{ document: string, metadata: object }>} appearances
 * @param {Array<{ document: string, metadata: object, distance?: number }>} scenes
 * @returns {string}
 */
function summarizeMemories(appearances, scenes) {
  const lines = ['', 'SEMANTIC MEMORY (from prior observations):'];

  if (appearances.length > 0) {
    lines.push('');
    lines.push('Canonical character appearances:');
    for (const app of appearances) {
      const obs = app.metadata?.observationCount;
      const tag = obs > 1 ? ` (seen ${obs} times)` : '';
      lines.push(`- ${app.document}${tag}`);
    }
  }

  const ranked = rankScenes(scenes);
  if (ranked.length > 0) {
    lines.push('');
    lines.push('Related prior scenes:');
    for (const scene of ranked.slice(0, 2)) {
      const loc = scene.metadata?.location ? ` [${scene.metadata.location}]` : '';
      lines.push(`- ${scene.document.slice(0, 200)}${loc}`);
    }
  }

  lines.push('');
  lines.push('Use these memories to maintain visual consistency and narrative continuity.');

  return lines.join('\n');
}

/**
 * Rank story-scene results by usefulness: recency and similarity.
 * Lower distance = more similar. More recent = higher priority for ties.
 * @param {Array<{ document: string, metadata: object, distance?: number }>} scenes
 * @returns {Array<{ document: string, metadata: object, distance?: number }>}
 */
function rankScenes(scenes) {
  if (scenes.length === 0) return [];

  const now = Date.now();
  return [...scenes].sort((a, b) => {
    const distA = a.distance ?? 1;
    const distB = b.distance ?? 1;
    const ageA = (now - (a.metadata?.timestamp ?? 0)) / 3_600_000;
    const ageB = (now - (b.metadata?.timestamp ?? 0)) / 3_600_000;
    const scoreA = distA + ageA * 0.01;
    const scoreB = distB + ageB * 0.01;
    return scoreA - scoreB;
  });
}

/**
 * Safely get a document by ID, returning null if it doesn't exist.
 * @param {object} collection
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function safeGet(collection, id) {
  try {
    const result = await collection.get({ ids: [id] });
    if (result?.ids?.length > 0) return result;
    return null;
  } catch {
    return null;
  }
}

/**
 * Zip a Chroma get() result into an array of { id, document, metadata } objects.
 * @param {object} results
 * @returns {Array<{ id: string, document: string, metadata: object }>}
 */
function zipResults(results) {
  if (!results?.ids?.length) return [];
  return results.ids.map((id, i) => ({
    id,
    document: results.documents?.[i] ?? '',
    metadata: results.metadatas?.[i] ?? {},
  }));
}

/**
 * Zip a Chroma query() result into an array of { id, document, metadata, distance } objects.
 * @param {object} results
 * @returns {Array<{ id: string, document: string, metadata: object, distance: number }>}
 */
function zipQueryResults(results) {
  if (!results?.ids?.[0]?.length) return [];
  return results.ids[0].map((id, i) => ({
    id,
    document: results.documents?.[0]?.[i] ?? '',
    metadata: results.metadatas?.[0]?.[i] ?? {},
    distance: results.distances?.[0]?.[i] ?? 1,
  }));
}
