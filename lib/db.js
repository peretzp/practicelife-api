// SQLite access to MemoryAtlas database (read-only)
// Requires: npm install better-sqlite3

const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'tools/memoryatlas/data/atlas.db');

let _db = null;

function getDb() {
  if (!_db) {
    try {
      const Database = require('better-sqlite3');
      _db = new Database(DB_PATH, { readonly: true });
      _db.pragma('journal_mode = WAL');
    } catch (err) {
      console.error(`[db] Cannot open ${DB_PATH}: ${err.message}`);
      return null;
    }
  }
  return _db;
}

function close() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = { getDb, close, DB_PATH };
