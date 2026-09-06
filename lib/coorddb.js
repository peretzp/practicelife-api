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
  // Migrate the transient dedup table BEFORE (re)creating it. Only this table
  // is ever dropped — the others hold durable data.
  migrateProcessedEvents();

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
      ts INTEGER,
      status TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_coord_events_source ON coord_events(source);
    CREATE INDEX IF NOT EXISTS idx_coord_events_kind ON coord_events(kind);
  `);
}

// processed_events holds only transient dedup bookkeeping. Earlier builds
// created it as (key TEXT, ts TEXT) with no status column; claimEvent's
// SELECT ts,status would throw against that shape. Since the data is
// disposable, drop-and-recreate is the safe migration. Never touches any
// other table.
function migrateProcessedEvents() {
  const cols = _db.prepare('PRAGMA table_info(processed_events)').all();
  if (cols.length === 0) return; // table does not exist yet — nothing to migrate
  const hasStatus = cols.some(c => c.name === 'status');
  const tsCol = cols.find(c => c.name === 'ts');
  const tsIsInteger = !!tsCol && String(tsCol.type).toUpperCase() === 'INTEGER';
  if (!hasStatus || !tsIsInteger) {
    _db.exec('DROP TABLE processed_events');
  }
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

// --- IDEMPOTENCY (claim / complete / release) ---
//
// A durable claim protocol so an alert is never lost mid-processing:
//   claimEvent  -> reserve the key ('processing') before doing work
//   completeEvent -> mark 'done' once the durable record is persisted
//   releaseEvent  -> delete the claim if the durable step failed (allow retry)
// A 'processing' claim older than staleMs is treated as abandoned (crash /
// restart) and can be reclaimed, so a Slack retry still gets through.

// Reserve an event key for processing. Runs in a transaction so concurrent
// retries can't both claim. Returns one of:
//   { claimed: true }                  — fresh claim
//   { claimed: true, reclaimed: true } — stale 'processing' claim taken over
//   { claimed: false, duplicate: true }— already done, or in-flight & not stale
function claimEvent(key, staleMs = 60000) {
  const db = getDb();
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT ts, status FROM processed_events WHERE key = ?').get(key);
    const now = Date.now();
    if (!row) {
      db.prepare('INSERT INTO processed_events (key, ts, status) VALUES (?, ?, ?)')
        .run(key, now, 'processing');
      return { claimed: true };
    }
    if (row.status === 'done') {
      return { claimed: false, duplicate: true };
    }
    // status === 'processing'
    if (now - row.ts > staleMs) {
      db.prepare('UPDATE processed_events SET ts = ? WHERE key = ?').run(now, key);
      return { claimed: true, reclaimed: true };
    }
    return { claimed: false, duplicate: true };
  });
  return tx();
}

// Mark a claimed event as fully processed (durable record persisted).
function completeEvent(key) {
  const db = getDb();
  db.prepare('UPDATE processed_events SET status = ?, ts = ? WHERE key = ?')
    .run('done', Date.now(), key);
}

// Drop a claim so the event can be retried (durable step failed).
function releaseEvent(key) {
  const db = getDb();
  db.prepare('DELETE FROM processed_events WHERE key = ?').run(key);
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
  getDb, close, DB_PATH, initSchema,
  appendEvent, listEvents,
  upsertAgent, listAgents, getAgent,
  claimEvent, completeEvent, releaseEvent,
  getState,
};
