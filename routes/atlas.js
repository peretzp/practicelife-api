// /api/atlas/* — MemoryAtlas voice memo endpoints
const { getDb } = require('../lib/db');

function register(router) {
  // List all assets (paginated)
  router.get('/api/atlas/assets', (req, params) => {
    const db = getDb();
    if (!db) return { status: 503, body: { error: 'MemoryAtlas database unavailable' } };

    const url = new URL(req.url, 'http://localhost');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const type = url.searchParams.get('type'); // voice_memo, video, audio_import

    let query = 'SELECT * FROM asset';
    const args = [];
    if (type) {
      query += ' WHERE source_type = ?';
      args.push(type);
    }
    query += ' ORDER BY recorded_at DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);

    const rows = db.prepare(query).all(...args);

    let countQuery = 'SELECT COUNT(*) as count FROM asset';
    const countArgs = [];
    if (type) {
      countQuery += ' WHERE source_type = ?';
      countArgs.push(type);
    }
    const total = db.prepare(countQuery).get(...countArgs);

    return { status: 200, body: { assets: rows, total: total.count, limit, offset } };
  });

  // Get single asset by ID
  router.get('/api/atlas/assets/:id', (req, params) => {
    const db = getDb();
    if (!db) return { status: 503, body: { error: 'MemoryAtlas database unavailable' } };

    const row = db.prepare('SELECT * FROM asset WHERE id = ?').get(params.id);
    if (!row) return { status: 404, body: { error: 'Asset not found' } };

    return { status: 200, body: row };
  });

  // MemoryAtlas stats
  router.get('/api/atlas/stats', (req, params) => {
    const db = getDb();
    if (!db) return { status: 503, body: { error: 'MemoryAtlas database unavailable' } };

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_assets,
        SUM(duration_sec) as total_duration_seconds,
        MIN(recorded_at) as earliest,
        MAX(recorded_at) as latest,
        SUM(CASE WHEN transcript_status = 'done' THEN 1 ELSE 0 END) as transcribed_count,
        SUM(CASE WHEN published_at IS NOT NULL THEN 1 ELSE 0 END) as published_count,
        SUM(file_size_bytes) as total_size_bytes
      FROM asset
    `).get();

    const byType = db.prepare(`
      SELECT source_type, COUNT(*) as count
      FROM asset GROUP BY source_type
    `).all();

    return { status: 200, body: { ...stats, byType } };
  });

  // Search assets by title
  router.get('/api/atlas/search/:query', (req, params) => {
    const db = getDb();
    if (!db) return { status: 503, body: { error: 'MemoryAtlas database unavailable' } };

    const rows = db.prepare(
      "SELECT id, title, source_type, duration_sec, recorded_at, transcript_status, note_path FROM asset WHERE title LIKE ? ORDER BY recorded_at DESC LIMIT 50"
    ).all(`%${params.query}%`);

    return { status: 200, body: { results: rows, query: params.query, count: rows.length } };
  });
}

module.exports = { register };
