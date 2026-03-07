// ═══════════════════════════════════════════════
// DB — SQLite persistence for campaign state
// Schema init, campaign/event/location/character access.
// ═══════════════════════════════════════════════

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_DB_PATH = path.resolve(__dirname, '..', 'data', 'living-worlds.db');
const DEFAULT_CAMPAIGN_NAME = 'Bedtime Story';

const DEFAULT_BEDTIME_CHARACTER = {
  name: 'Moonbeam Bunny',
  role: 'Bedtime Guide',
  description: 'A gentle storybook guide with a lantern and a sleepy smile',
};

const DEFAULT_BEDTIME_LOCATION = 'The Moonlit Nursery';

const DEFAULT_GAME_CHARACTER = {
  name: 'Thorn',
  role: 'Shadow Ranger',
  description: 'A hooded figure with silver eyes',
};

const DEFAULT_GAME_LOCATION = 'The Rusty Chalice Tavern';

let db = null;

/**
 * Initialize the database: ensure directory exists, create tables, seed default campaign.
 * Call once at server startup (sync).
 */
export function initDb() {
  const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS campaign_characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaign_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      UNIQUE(campaign_id, name)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      dice_roll INTEGER,
      narration TEXT NOT NULL,
      scene_prompt TEXT NOT NULL,
      music_mood TEXT NOT NULL,
      location TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      appearance TEXT NOT NULL,
      source_frame_ts INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(campaign_id, label)
    );

    CREATE TABLE IF NOT EXISTS story_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      child_name TEXT NOT NULL,
      child_age INTEGER NOT NULL,
      learning_goals TEXT NOT NULL,
      story_energy REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(campaign_id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_campaign ON events(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_characters_campaign ON campaign_characters(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_locations_campaign ON campaign_locations(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_session_profiles_campaign ON session_profiles(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_story_sessions_campaign ON story_sessions(campaign_id);
  `);

  migrateSchema(db);
  ensureDefaultCampaign(db);

  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

/**
 * Get campaign by id in the same shape as the old in-memory campaign:
 * { characters: [{ name, role, description }], locations: [string], events: [{ ... }] }
 * @param {number} campaignId
 * @returns {{ characters: Array<{name: string, role: string, description: string}>, locations: string[], events: Array<object> }}
 */
export function getCampaign(campaignId) {
  const database = getDb();

  const characters = database
    .prepare(
      'SELECT name, role, description FROM campaign_characters WHERE campaign_id = ? ORDER BY id'
    )
    .all(campaignId)
    .map((row) => ({
      name: row.name,
      role: row.role,
      description: row.description,
    }));

  const locations = database
    .prepare('SELECT name FROM campaign_locations WHERE campaign_id = ? ORDER BY id')
    .all(campaignId)
    .map((row) => row.name);

  const events = database
    .prepare(
      `SELECT
         action,
         dice_roll AS diceRoll,
         narration,
         scene_prompt,
         music_mood,
         location,
         timestamp,
         image_url AS imageUrl,
         image_source AS imageSource,
         learning_moment AS learningMoment,
         theme,
         mood,
         intensity,
         emotion,
         event_kind AS eventKind
       FROM events
       WHERE campaign_id = ?
       ORDER BY id`
    )
    .all(campaignId)
    .map((row) => ({
      action: row.action,
      diceRoll: row.diceRoll,
      narration: row.narration,
      scene_prompt: row.scene_prompt,
      music_mood: row.music_mood,
      location: row.location,
      timestamp: row.timestamp,
      imageUrl: row.imageUrl ?? null,
      imageSource: row.imageSource ?? null,
      learningMoment: row.learningMoment ?? null,
      theme: row.theme ?? null,
      mood: row.mood ?? null,
      intensity: row.intensity ?? null,
      emotion: row.emotion ?? null,
      eventKind: row.eventKind ?? null,
    }));

  return { characters, locations, events };
}

/**
 * Append an event to a campaign.
 * @param {number} campaignId
 * @param {{ action: string, diceRoll: number|null, narration: string, scene_prompt: string, music_mood: string, location: string, timestamp: number, imageUrl?: string|null, imageSource?: string|null, learningMoment?: string|null, theme?: string|null, mood?: string|null, intensity?: number|null, emotion?: string|null, eventKind?: string|null }} event
 */
export function appendEvent(campaignId, event) {
  getDb()
    .prepare(
      `INSERT INTO events (
         campaign_id,
         action,
         dice_roll,
         narration,
         scene_prompt,
         music_mood,
         location,
         timestamp,
         image_url,
         image_source,
         learning_moment,
         theme,
         mood,
         intensity,
         emotion,
         event_kind
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      campaignId,
      event.action,
      event.diceRoll ?? null,
      event.narration,
      event.scene_prompt,
      event.music_mood,
      event.location,
      event.timestamp,
      event.imageUrl ?? null,
      event.imageSource ?? null,
      event.learningMoment ?? null,
      event.theme ?? null,
      event.mood ?? null,
      event.intensity ?? null,
      event.emotion ?? null,
      event.eventKind ?? null
    );
}

/**
 * Add a location to a campaign if not already present.
 * @param {number} campaignId
 * @param {string} name
 */
export function addLocation(campaignId, name) {
  if (!name) return;
  const database = getDb();
  const exists = database
    .prepare('SELECT 1 FROM campaign_locations WHERE campaign_id = ? AND name = ?')
    .get(campaignId, name);
  if (!exists) {
    database.prepare('INSERT INTO campaign_locations (campaign_id, name) VALUES (?, ?)').run(campaignId, name);
  }
}

/**
 * Get or create the default campaign (id = 1 or first row). Seeds Thorn + Rusty Chalice if new.
 * @returns {number} campaign id
 */
export function getOrCreateDefaultCampaign() {
  const database = getDb();
  return ensureDefaultCampaign(database);
}

/**
 * Reset a campaign: delete all events and reset characters/locations to seed state.
 * @param {number} campaignId
 */
export function resetCampaign(campaignId) {
  const database = getDb();
  database.prepare('DELETE FROM events WHERE campaign_id = ?').run(campaignId);
  database.prepare('DELETE FROM campaign_characters WHERE campaign_id = ?').run(campaignId);
  database.prepare('DELETE FROM campaign_locations WHERE campaign_id = ?').run(campaignId);
  database.prepare('DELETE FROM session_profiles WHERE campaign_id = ?').run(campaignId);
  database.prepare('DELETE FROM story_sessions WHERE campaign_id = ?').run(campaignId);

  seedCampaignDefaults(database, campaignId, getCampaignSeedMode(campaignId));

  const now = Date.now();
  database.prepare('UPDATE campaigns SET updated_at = ? WHERE id = ?').run(now, campaignId);
}

/**
 * Create a new campaign with default seed character and location.
 * @param {string} name
 * @returns {number} campaign id
 */
export function createCampaign(name) {
  const database = getDb();
  const now = Date.now();
  const result = database
    .prepare('INSERT INTO campaigns (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run(name || 'Unnamed campaign', now, now);
  const campaignId = result.lastInsertRowid;

  seedCampaignDefaults(database, campaignId, 'game');

  return campaignId;
}

/**
 * List all campaigns (id and name).
 * @returns {Array<{ id: number, name: string }>}
 */
export function listCampaigns() {
  return getDb()
    .prepare('SELECT id, name FROM campaigns ORDER BY id')
    .all()
    .map((row) => ({ id: row.id, name: row.name }));
}

/**
 * Get event count for a campaign (for health endpoint).
 * @param {number} campaignId
 * @returns {number}
 */
export function getEventCount(campaignId) {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS count FROM events WHERE campaign_id = ?')
    .get(campaignId);
  return row ? row.count : 0;
}

/**
 * Check if a campaign exists.
 * @param {number} campaignId
 * @returns {boolean}
 */
export function campaignExists(campaignId) {
  const row = getDb().prepare('SELECT 1 FROM campaigns WHERE id = ?').get(campaignId);
  return !!row;
}

// ── Session Profiles (vision-extracted character appearances) ──

/**
 * Insert or replace a session profile for a campaign.
 * Uses UNIQUE(campaign_id, label) so re-analyzing a frame overwrites the previous profile.
 * @param {number} campaignId
 * @param {string} label - Role label (e.g. "child", "adult")
 * @param {object} appearance - Full appearance description object from Gemini Vision
 * @param {number} [frameTs] - Timestamp of the source frame
 */
export function upsertSessionProfile(campaignId, label, appearance, frameTs) {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO session_profiles (campaign_id, label, appearance, source_frame_ts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id, label) DO UPDATE SET
         appearance = excluded.appearance,
         source_frame_ts = excluded.source_frame_ts,
         updated_at = excluded.updated_at`
    )
    .run(campaignId, label, JSON.stringify(appearance), frameTs ?? now, now, now);
}

/**
 * Get all session profiles for a campaign.
 * @param {number} campaignId
 * @returns {Array<{label: string, appearance: object, updated_at: number}>}
 */
export function getSessionProfiles(campaignId) {
  return getDb()
    .prepare('SELECT label, appearance, updated_at FROM session_profiles WHERE campaign_id = ? ORDER BY id')
    .all(campaignId)
    .map((row) => ({
      label: row.label,
      appearance: JSON.parse(row.appearance),
      updated_at: row.updated_at,
    }));
}

/**
 * Delete all session profiles for a campaign.
 * @param {number} campaignId
 */
export function clearSessionProfiles(campaignId) {
  getDb().prepare('DELETE FROM session_profiles WHERE campaign_id = ?').run(campaignId);
}

/**
 * Create or update the bedtime story session config for a campaign.
 * Resets story energy to 1.0 whenever the configuration changes.
 * @param {number} campaignId
 * @param {{ childName: string, childAge: number, learningGoals?: string[] }} input
 * @returns {{ id: number, campaign_id: number, child_name: string, child_age: number, learning_goals: string[], story_energy: number, created_at: number, updated_at: number }}
 */
export function createStorySession(campaignId, input) {
  const database = getDb();
  const now = Date.now();
  const normalizedGoals = normalizeLearningGoals(input.learningGoals);

  database
    .prepare(
      `INSERT INTO story_sessions (
         campaign_id,
         child_name,
         child_age,
         learning_goals,
         story_energy,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id) DO UPDATE SET
         child_name = excluded.child_name,
         child_age = excluded.child_age,
         learning_goals = excluded.learning_goals,
         story_energy = excluded.story_energy,
         updated_at = excluded.updated_at`
    )
    .run(
      campaignId,
      String(input.childName || '').trim(),
      Number(input.childAge),
      JSON.stringify(normalizedGoals),
      1.0,
      now,
      now
    );

  return getStorySession(campaignId);
}

/**
 * Get the bedtime story session config for a campaign.
 * @param {number} campaignId
 * @returns {{ id: number, campaign_id: number, child_name: string, child_age: number, learning_goals: string[], story_energy: number, created_at: number, updated_at: number }|null}
 */
export function getStorySession(campaignId) {
  const row = getDb()
    .prepare(
      `SELECT
         id,
         campaign_id,
         child_name,
         child_age,
         learning_goals,
         story_energy,
         created_at,
         updated_at
       FROM story_sessions
       WHERE campaign_id = ?`
    )
    .get(campaignId);

  return row ? mapStorySession(row) : null;
}

/**
 * Update the bedtime story energy for a campaign.
 * @param {number} campaignId
 * @param {number} storyEnergy
 * @returns {{ id: number, campaign_id: number, child_name: string, child_age: number, learning_goals: string[], story_energy: number, created_at: number, updated_at: number }|null}
 */
export function updateStoryEnergy(campaignId, storyEnergy) {
  const normalizedEnergy = clampStoryEnergy(storyEnergy);
  getDb()
    .prepare('UPDATE story_sessions SET story_energy = ?, updated_at = ? WHERE campaign_id = ?')
    .run(normalizedEnergy, Date.now(), campaignId);
  return getStorySession(campaignId);
}

/**
 * Return full event rows for bedtime-story export.
 * @param {number} campaignId
 * @returns {Array<{ narration: string, scene_prompt: string, imageUrl: string|null, imageSource: string|null, learningMoment: string|null, location: string, timestamp: number }>}
 */
export function getStoryPages(campaignId) {
  return getDb()
    .prepare(
      `SELECT
         narration,
         scene_prompt,
         image_url AS imageUrl,
         image_source AS imageSource,
         learning_moment AS learningMoment,
         location,
         timestamp
       FROM events
       WHERE campaign_id = ?
         AND (event_kind = 'story' OR (event_kind IS NULL AND learning_moment IS NOT NULL))
       ORDER BY id`
    )
    .all(campaignId)
    .map((row) => ({
      narration: row.narration,
      scene_prompt: row.scene_prompt,
      imageUrl: row.imageUrl ?? null,
      imageSource: row.imageSource ?? null,
      learningMoment: row.learningMoment ?? null,
      location: row.location,
      timestamp: row.timestamp,
    }));
}

/**
 * Persist a bedtime story beat and update story energy atomically.
 * @param {number} campaignId
 * @param {{ action: string, diceRoll: number|null, narration: string, scene_prompt: string, music_mood: string, location: string, timestamp: number, imageUrl?: string|null, imageSource?: string|null, learningMoment?: string|null, theme?: string|null, mood?: string|null, intensity?: number|null, emotion?: string|null, eventKind?: string|null }} event
 * @param {number} storyEnergy
 */
export function saveStoryBeat(campaignId, event, storyEnergy) {
  const database = getDb();
  const insertEvent = database.prepare(
    `INSERT INTO events (
       campaign_id,
       action,
       dice_roll,
       narration,
       scene_prompt,
       music_mood,
       location,
       timestamp,
       image_url,
       image_source,
       learning_moment,
       theme,
       mood,
       intensity,
       emotion,
       event_kind
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertLocation = database.prepare(
    'INSERT OR IGNORE INTO campaign_locations (campaign_id, name) VALUES (?, ?)'
  );
  const updateEnergy = database.prepare(
    'UPDATE story_sessions SET story_energy = ?, updated_at = ? WHERE campaign_id = ?'
  );

  database.transaction(() => {
    insertEvent.run(
      campaignId,
      event.action,
      event.diceRoll ?? null,
      event.narration,
      event.scene_prompt,
      event.music_mood,
      event.location,
      event.timestamp,
      event.imageUrl ?? null,
      event.imageSource ?? null,
      event.learningMoment ?? null,
      event.theme ?? null,
      event.mood ?? null,
      event.intensity ?? null,
      event.emotion ?? null,
      event.eventKind ?? 'story'
    );

    if (event.location) {
      insertLocation.run(campaignId, event.location);
    }

    updateEnergy.run(clampStoryEnergy(storyEnergy), Date.now(), campaignId);
  })();
}

/**
 * Create missing columns when running against an existing SQLite file.
 * @param {Database.Database} database
 */
function migrateSchema(database) {
  ensureColumn(database, 'events', 'image_url', 'TEXT');
  ensureColumn(database, 'events', 'image_source', 'TEXT');
  ensureColumn(database, 'events', 'learning_moment', 'TEXT');
  ensureColumn(database, 'events', 'theme', 'TEXT');
  ensureColumn(database, 'events', 'mood', 'TEXT');
  ensureColumn(database, 'events', 'intensity', 'REAL');
  ensureColumn(database, 'events', 'emotion', 'TEXT');
  ensureColumn(database, 'events', 'event_kind', 'TEXT');
}

/**
 * Ensure the default campaign exists.
 * @param {Database.Database} database
 * @returns {number}
 */
function ensureDefaultCampaign(database) {
  let row = database.prepare('SELECT id FROM campaigns WHERE id = 1').get();
  if (!row) {
    const now = Date.now();
    const result = database
      .prepare('INSERT INTO campaigns (name, created_at, updated_at) VALUES (?, ?, ?)')
      .run(DEFAULT_CAMPAIGN_NAME, now, now);
    row = { id: result.lastInsertRowid };
    seedCampaignDefaults(database, row.id, 'bedtime');
  }
  return row.id;
}

/**
 * Ensure a campaign has seed character and location for its mode.
 * @param {Database.Database} database
 * @param {number} campaignId
 * @param {'bedtime'|'game'} mode
 */
function seedCampaignDefaults(database, campaignId, mode) {
  const defaults = getSeedDefaults(mode);
  const characterCount = database
    .prepare('SELECT COUNT(*) AS count FROM campaign_characters WHERE campaign_id = ?')
    .get(campaignId)
    .count;
  if (characterCount === 0) {
    database
      .prepare(
        'INSERT INTO campaign_characters (campaign_id, name, role, description) VALUES (?, ?, ?, ?)'
      )
      .run(campaignId, defaults.character.name, defaults.character.role, defaults.character.description);
  }

  const locationCount = database
    .prepare('SELECT COUNT(*) AS count FROM campaign_locations WHERE campaign_id = ?')
    .get(campaignId)
    .count;
  if (locationCount === 0) {
    database.prepare('INSERT INTO campaign_locations (campaign_id, name) VALUES (?, ?)').run(campaignId, defaults.location);
  }
}

/**
 * Resolve which seed mode should be used for a campaign reset.
 * @param {number} campaignId
 * @returns {'bedtime'|'game'}
 */
function getCampaignSeedMode(campaignId) {
  return campaignId === 1 ? 'bedtime' : 'game';
}

/**
 * Return seed defaults for a campaign mode.
 * @param {'bedtime'|'game'} mode
 * @returns {{ character: { name: string, role: string, description: string }, location: string }}
 */
function getSeedDefaults(mode) {
  if (mode === 'bedtime') {
    return {
      character: DEFAULT_BEDTIME_CHARACTER,
      location: DEFAULT_BEDTIME_LOCATION,
    };
  }

  return {
    character: DEFAULT_GAME_CHARACTER,
    location: DEFAULT_GAME_LOCATION,
  };
}

/**
 * Add a column to a table when it is missing.
 * @param {Database.Database} database
 * @param {string} tableName
 * @param {string} columnName
 * @param {string} columnType
 */
function ensureColumn(database, tableName, columnName, columnType) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some((column) => column.name === columnName);
  if (!hasColumn) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
}

/**
 * Convert a raw story_session row into API shape.
 * @param {{ id: number, campaign_id: number, child_name: string, child_age: number, learning_goals: string, story_energy: number, created_at: number, updated_at: number }} row
 * @returns {{ id: number, campaign_id: number, child_name: string, child_age: number, learning_goals: string[], story_energy: number, created_at: number, updated_at: number }}
 */
function mapStorySession(row) {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    child_name: row.child_name,
    child_age: row.child_age,
    learning_goals: safeParseGoals(row.learning_goals),
    story_energy: clampStoryEnergy(row.story_energy),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Normalize learning goals to a compact string array.
 * @param {string[]|undefined} goals
 * @returns {string[]}
 */
function normalizeLearningGoals(goals) {
  if (!Array.isArray(goals)) return [];
  return goals
    .map((goal) => String(goal || '').trim())
    .filter(Boolean);
}

/**
 * Parse serialized learning goals safely.
 * @param {string} rawGoals
 * @returns {string[]}
 */
function safeParseGoals(rawGoals) {
  try {
    const parsed = JSON.parse(rawGoals);
    return normalizeLearningGoals(parsed);
  } catch {
    return [];
  }
}

/**
 * Clamp story energy into the 0..1 range.
 * @param {number} storyEnergy
 * @returns {number}
 */
function clampStoryEnergy(storyEnergy) {
  const numeric = Number(storyEnergy);
  if (Number.isNaN(numeric)) return 1.0;
  return Math.max(0, Math.min(1, numeric));
}
