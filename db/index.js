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
const DEFAULT_CAMPAIGN_NAME = 'Default campaign';

const DEFAULT_CHARACTER = {
  name: 'Thorn',
  role: 'Shadow Ranger',
  description: 'A hooded figure with silver eyes',
};

const DEFAULT_LOCATION = 'The Rusty Chalice Tavern';

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

    CREATE INDEX IF NOT EXISTS idx_events_campaign ON events(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_characters_campaign ON campaign_characters(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_locations_campaign ON campaign_locations(campaign_id);
  `);

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
 * @returns {{ characters: Array<{name: string, role: string, description: string}>, locations: string[], events: Array<{action: string, diceRoll: number|null, narration: string, scene_prompt: string, music_mood: string, location: string, timestamp: number}> }}
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
      'SELECT action, dice_roll AS diceRoll, narration, scene_prompt, music_mood, location, timestamp FROM events WHERE campaign_id = ? ORDER BY id'
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
    }));

  return { characters, locations, events };
}

/**
 * Append an event to a campaign.
 * @param {number} campaignId
 * @param {{ action: string, diceRoll: number|null, narration: string, scene_prompt: string, music_mood: string, location: string, timestamp: number }} event
 */
export function appendEvent(campaignId, event) {
  getDb()
    .prepare(
      `INSERT INTO events (campaign_id, action, dice_roll, narration, scene_prompt, music_mood, location, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      campaignId,
      event.action,
      event.diceRoll ?? null,
      event.narration,
      event.scene_prompt,
      event.music_mood,
      event.location,
      event.timestamp
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
  let row = database.prepare('SELECT id FROM campaigns WHERE id = 1').get();
  if (row) {
    return row.id;
  }
  const now = Date.now();
  const result = database
    .prepare('INSERT INTO campaigns (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run(DEFAULT_CAMPAIGN_NAME, now, now);
  const campaignId = result.lastInsertRowid;

  database
    .prepare(
      'INSERT INTO campaign_characters (campaign_id, name, role, description) VALUES (?, ?, ?, ?)'
    )
    .run(campaignId, DEFAULT_CHARACTER.name, DEFAULT_CHARACTER.role, DEFAULT_CHARACTER.description);

  database.prepare('INSERT INTO campaign_locations (campaign_id, name) VALUES (?, ?)').run(campaignId, DEFAULT_LOCATION);

  return campaignId;
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

  database
    .prepare(
      'INSERT INTO campaign_characters (campaign_id, name, role, description) VALUES (?, ?, ?, ?)'
    )
    .run(campaignId, DEFAULT_CHARACTER.name, DEFAULT_CHARACTER.role, DEFAULT_CHARACTER.description);
  database.prepare('INSERT INTO campaign_locations (campaign_id, name) VALUES (?, ?)').run(campaignId, DEFAULT_LOCATION);

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

  database
    .prepare(
      'INSERT INTO campaign_characters (campaign_id, name, role, description) VALUES (?, ?, ?, ?)'
    )
    .run(campaignId, DEFAULT_CHARACTER.name, DEFAULT_CHARACTER.role, DEFAULT_CHARACTER.description);
  database.prepare('INSERT INTO campaign_locations (campaign_id, name) VALUES (?, ?)').run(campaignId, DEFAULT_LOCATION);

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
