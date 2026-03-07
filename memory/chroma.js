// ═══════════════════════════════════════════════
// CHROMA — Semantic memory layer
// Optional sidecar for character consistency,
// story-scene recall, and prompt enrichment.
// SQLite remains the source of truth; Chroma is
// a derived semantic index that can be unavailable
// without breaking the core pipeline.
// ═══════════════════════════════════════════════

import { ChromaClient } from 'chromadb';

const CHROMA_HOST = process.env.CHROMA_HOST || 'localhost';
const CHROMA_PORT = parseInt(process.env.CHROMA_PORT || '8000', 10);
const CHROMA_SSL = process.env.CHROMA_SSL === 'true';
const COLLECTION_PREFIX = process.env.CHROMA_COLLECTION_PREFIX || 'lw';
const TOP_K = parseInt(process.env.CHROMA_TOP_K || '5', 10);
const RETRIEVAL_TIMEOUT_MS = 2000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;

let client = null;
let appearanceCollection = null;
let storyCollection = null;
let enabled = false;

let storyDocCounter = 0;

/** In-memory cache of observation counts keyed by doc ID. */
const observationCounts = new Map();

/** Consecutive failure count for circuit breaker. */
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

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
    client = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT, ssl: CHROMA_SSL });
    await client.heartbeat();

    appearanceCollection = await client.getOrCreateCollection({
      name: `${COLLECTION_PREFIX}_appearance`,
    });
    storyCollection = await client.getOrCreateCollection({
      name: `${COLLECTION_PREFIX}_story`,
    });

    enabled = true;
    consecutiveFailures = 0;
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
 * Tracks observation count via in-memory cache to avoid a read-before-write round trip.
 * @param {number} campaignId
 * @param {{ label: string, fantasy_name?: string, character_description?: string, hair?: string, clothing?: string, features?: string, age_range?: string }} person
 * @param {string} [setting] - Environment description from the camera frame
 */
export async function upsertAppearanceMemory(campaignId, person, setting) {
  if (!isAvailable()) return;
  try {
    const docId = `appearance_${campaignId}_${person.label}`;
    const observationCount = (observationCounts.get(docId) ?? 0) + 1;
    observationCounts.set(docId, observationCount);

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
    recordSuccess();
  } catch (err) {
    recordFailure('Appearance upsert', err);
  }
}

/**
 * Retrieve canonical appearance memories for a campaign.
 * @param {number} campaignId
 * @param {number} [limit]
 * @returns {Promise<Array<{ id: string, document: string, metadata: object }>>}
 */
export async function getAppearanceMemories(campaignId, limit = TOP_K) {
  if (!isAvailable()) return [];
  try {
    const results = await appearanceCollection.get({
      where: { campaignId },
      limit,
    });
    recordSuccess();
    return zipResults(results);
  } catch (err) {
    recordFailure('Appearance retrieval', err);
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
  if (!isAvailable()) return;
  try {
    const docId = `story_${campaignId}_${event.timestamp}_${storyDocCounter++}`;
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
    recordSuccess();
  } catch (err) {
    recordFailure('Story memory upsert', err);
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
  if (!isAvailable()) return [];
  try {
    const results = await storyCollection.query({
      queryTexts: [queryText],
      nResults: limit,
      where: { campaignId },
    });
    recordSuccess();
    return zipQueryResults(results);
  } catch (err) {
    recordFailure('Story query', err);
    return [];
  }
}

// ── Retrieval + Summarization ───────────────────

/**
 * Retrieve and summarize all relevant memories for a bedtime story beat.
 * Returns a compact prompt-ready text block, or empty string if nothing useful is found.
 * Times out after RETRIEVAL_TIMEOUT_MS so Chroma latency never blocks the beat path.
 * @param {number} campaignId
 * @param {string} action - The player/listener action triggering the beat
 * @returns {Promise<string>}
 */
export async function retrieveMemoryContext(campaignId, action) {
  if (!isAvailable()) return '';

  try {
    const result = await withTimeout(
      retrieveMemoryContextInner(campaignId, action),
      RETRIEVAL_TIMEOUT_MS,
    );
    return result;
  } catch (err) {
    recordFailure('Memory retrieval timeout', err);
    return '';
  }
}

// ── Campaign Reset ──────────────────────────────

/**
 * Delete all Chroma documents for a campaign.
 * Call after SQLite campaign reset so stale memories don't leak into the next session.
 * @param {number} campaignId
 */
export async function clearCampaignMemory(campaignId) {
  if (!isAvailable()) return;
  try {
    await deleteByFilter(appearanceCollection, { campaignId });
    await deleteByFilter(storyCollection, { campaignId });

    for (const [key] of observationCounts) {
      if (key.startsWith(`appearance_${campaignId}_`)) {
        observationCounts.delete(key);
      }
    }
  } catch (err) {
    recordFailure('Campaign memory clear', err);
  }
}

// ── Helpers ─────────────────────────────────────

/**
 * Core retrieval logic separated from the timeout wrapper.
 * @param {number} campaignId
 * @param {string} action
 * @returns {Promise<string>}
 */
async function retrieveMemoryContextInner(campaignId, action) {
  const [appearances, scenes] = await Promise.all([
    getAppearanceMemories(campaignId, 3),
    queryStoryMemories(campaignId, action, 4),
  ]);

  if (appearances.length === 0 && scenes.length === 0) return '';

  return summarizeMemories(appearances, scenes);
}

/**
 * Race a promise against a timeout. Rejects with a descriptive error on timeout.
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 * @template T
 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Check whether Chroma is enabled and the circuit breaker is closed.
 * @returns {boolean}
 */
function isAvailable() {
  if (!enabled) return false;
  if (Date.now() < circuitOpenUntil) return false;
  return true;
}

/**
 * Record a successful Chroma operation; resets the circuit breaker.
 */
function recordSuccess() {
  consecutiveFailures = 0;
}

/**
 * Record a failed Chroma operation and trip the circuit breaker if threshold is reached.
 * @param {string} operation
 * @param {Error} err
 */
function recordFailure(operation, err) {
  consecutiveFailures++;
  console.warn(`[CHROMA] ${operation} failed (${consecutiveFailures}/${CIRCUIT_BREAKER_THRESHOLD}):`, err.message);
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    console.warn(`[CHROMA] Circuit breaker open — pausing for ${CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s`);
  }
}

/**
 * Delete documents from a collection matching a where filter.
 * Chroma's delete API requires IDs, so we fetch matching IDs first.
 * @param {object} collection
 * @param {object} whereFilter
 */
async function deleteByFilter(collection, whereFilter) {
  const batch = await collection.get({ where: whereFilter, limit: 1000 });
  if (batch?.ids?.length > 0) {
    await collection.delete({ ids: batch.ids });
  }
}

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
