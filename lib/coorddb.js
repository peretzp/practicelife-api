// Coordination store — writable SQLite at ~/.claude/coord.db
// The shared spine for cross-repo/agent coordination: a pluggable agent registry
// and an append-only event log. Mirrors taskdb.js's schema-on-open pattern.

const path = require('path');
const os = require('os');
const fs = require('fs');

const DB_PATH = path.join(os.homedir(), '.claude', 'coord.db');

let _db = null;

function getDb() {
  if (!_db) {
    const Database = require('better-sqlite3');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    initSchema();
    seed();
  }
  return _db;
}

function initSchema() {
  _db.exec(`
    CREATE TABLE IF NOT EXISTS coord_agents (
      name TEXT PRIMARY KEY,
      kind TEXT,
      machine TEXT,
      repo TEXT,
      endpoint TEXT,
      last_seen TEXT,
      meta_json TEXT
    );

    CREATE TABLE IF NOT EXISTS coord_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT,
      source TEXT,
      actor TEXT,
      kind TEXT,
      ref TEXT,
      summary TEXT,
      payload_json TEXT,
      machine TEXT
    );

    CREATE TABLE IF NOT EXISTS processed_events (
      key TEXT PRIMARY KEY,
      ts TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_coord_events_source ON coord_events(source);
    CREATE INDEX IF NOT EXISTS idx_coord_events_kind ON coord_events(kind);
  `);
}

// Seed only the local practicelife agent on first open — no other rows hardcoded.
function seed() {
  const { c } = _db.prepare('SELECT COUNT(*) AS c FROM coord_agents').get();
  if (c === 0) {
    upsertAgent({
      name: 'practicelife',
      kind: 'api',
      machine: os.hostname(),
      repo: 'practicelife-api',
      endpoint: 'https://localhost:3001',
      meta: {},
    });
  }
}

// --- AGENTS ---

function rowToAgent(row) {
  if (!row) return null;
  return {
    name: row.name,
    kind: row.kind,
    machine: row.machine,
    repo: row.repo,
    endpoint: row.endpoint,
    last_seen: row.last_seen,
    meta: JSON.parse(row.meta_json || '{}'),
  };
}

function getAgent(name) {
  const db = getDb();
  return rowToAgent(db.prepare('SELECT * FROM coord_agents WHERE name = ?').get(name));
}

function upsertAgent({ name, kind, machine, repo, endpoint, meta }) {
  const db = getDb();
  const now = new Date().toISOString();
  const metaJson = meta === undefined ? null : JSON.stringify(meta || {});
  db.prepare(`
    INSERT INTO coord_agents (name, kind, machine, repo, endpoint, last_seen, meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      kind = COALESCE(excluded.kind, coord_agents.kind),
      machine = COALESCE(excluded.machine, coord_agents.machine),
      repo = COALESCE(excluded.repo, coord_agents.repo),
      endpoint = COALESCE(excluded.endpoint, coord_agents.endpoint),
      last_seen = excluded.last_seen,
      meta_json = COALESCE(excluded.meta_json, coord_agents.meta_json)
  `).run(name, kind || null, machine || null, repo || null, endpoint || null, now, metaJson);
  return getAgent(name);
}

function listAgents() {
  const db = getDb();
  return db.prepare('SELECT * FROM coord_agents ORDER BY name ASC').all().map(rowToAgent);
}

// --- EVENTS ---

function rowToEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    ts: row.ts,
    source: row.source,
    actor: row.actor,
    kind: row.kind,
    ref: row.ref,
    summary: row.summary,
    payload: JSON.parse(row.payload_json || '{}'),
    machine: row.machine,
  };
}

function getEvent(id) {
  const db = getDb();
  return rowToEvent(db.prepare('SELECT * FROM coord_events WHERE id = ?').get(id));
}

function appendEvent({ source, actor, kind, ref, summary, payload }) {
  const db = getDb();
  const ts = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO coord_events (ts, source, actor, kind, ref, summary, payload_json, machine)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ts,
    source || null,
    actor || null,
    kind || null,
    ref || null,
    summary || null,
    JSON.stringify(payload || {}),
    os.hostname()
  );
  return getEvent(result.lastInsertRowid);
}

function listEvents({ limit = 50, source, kind } = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];
  if (source) { conditions.push('source = ?'); params.push(source); }
  if (kind) { conditions.push('kind = ?'); params.push(kind); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const rows = db.prepare(`SELECT * FROM coord_events ${where} ORDER BY id DESC LIMIT ?`).all(...params, limit);
  return rows.map(rowToEvent);
}

// --- IDEMPOTENCY ---

// Record that an event key has been processed. Returns true iff this call
// inserted a NEW row (first time seen), false if it was already present.
// SQLite serializes the write, so concurrent retries can't both get true.
function markEventSeen(key) {
  const db = getDb();
  const info = db.prepare('INSERT OR IGNORE INTO processed_events (key, ts) VALUES (?, ?)')
    .run(key, new Date().toISOString());
  return info.changes === 1;
}

// --- AGGREGATE VIEW ---

function getState() {
  return {
    agents: listAgents(),
    recentEvents: listEvents({ limit: 50 }),
  };
}

function close() {
  if (_db) { _db.close(); _db = null; }
}

module.exports = {
  getDb, close, DB_PATH,
  appendEvent, listEvents,
  upsertAgent, listAgents, getAgent,
  markEventSeen,
  getState,
};
