// Unified Task Queue — SQLite database for cross-agent, cross-human task management
// Everyone (Peretz, Kevin, agents) shares one queue with per-task conversation threads

const path = require('path');
const os = require('os');

const DB_PATH = path.join(os.homedir(), '.claude', 'tasks.db');

let _db = null;

function getDb() {
  if (!_db) {
    const Database = require('better-sqlite3');
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema();
  }
  return _db;
}

function initSchema() {
  const db = _db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      owner TEXT NOT NULL DEFAULT 'peretz',
      assignee TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 3,
      source TEXT DEFAULT 'manual',
      category TEXT,
      section TEXT,
      tags TEXT DEFAULT '[]',
      due_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS task_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'update',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_watchers (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      watcher TEXT NOT NULL,
      PRIMARY KEY (task_id, watcher)
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
    CREATE INDEX IF NOT EXISTS idx_messages_task ON task_messages(task_id);
  `);

  // FTS5 for search (create only if not exists — check via pragma)
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(title, description, content=tasks, content_rowid=id)`);
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, content=task_messages, content_rowid=id)`);
  } catch (e) {
    // FTS tables may already exist
  }

  // Triggers to keep FTS in sync
  try {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
        INSERT INTO tasks_fts(rowid, title, description) VALUES (new.id, new.title, new.description);
      END;
      CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
        INSERT INTO tasks_fts(tasks_fts, rowid, title, description) VALUES ('delete', old.id, old.title, old.description);
      END;
      CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
        INSERT INTO tasks_fts(tasks_fts, rowid, title, description) VALUES ('delete', old.id, old.title, old.description);
        INSERT INTO tasks_fts(rowid, title, description) VALUES (new.id, new.title, new.description);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON task_messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON task_messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;
    `);
  } catch (e) {
    // Triggers may already exist
  }
}

// --- TASK CRUD ---

function createTask({ title, description, owner, assignee, priority, source, category, section, tags, due_date }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO tasks (title, description, owner, assignee, priority, source, category, section, tags, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    title,
    description || null,
    owner || 'peretz',
    assignee || null,
    priority || 3,
    source || 'manual',
    category || null,
    section || null,
    JSON.stringify(tags || []),
    due_date || null
  );
  return getTask(result.lastInsertRowid);
}

function getTask(id) {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) return null;
  task.tags = JSON.parse(task.tags || '[]');
  task.messages = db.prepare('SELECT * FROM task_messages WHERE task_id = ? ORDER BY created_at ASC').all(id);
  task.watchers = db.prepare('SELECT watcher FROM task_watchers WHERE task_id = ?').all(id).map(r => r.watcher);
  return task;
}

function listTasks({ owner, assignee, status, priority, category, source, limit, offset, sort } = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (owner) { conditions.push('owner = ?'); params.push(owner); }
  if (assignee) { conditions.push('assignee = ?'); params.push(assignee); }
  if (status) {
    if (status === 'open') {
      conditions.push("status IN ('pending', 'in_progress', 'blocked')");
    } else {
      conditions.push('status = ?'); params.push(status);
    }
  }
  if (priority) { conditions.push('priority = ?'); params.push(priority); }
  if (category) { conditions.push('category = ?'); params.push(category); }
  if (source) { conditions.push('source = ?'); params.push(source); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const orderBy = sort === 'updated' ? 'updated_at DESC' : 'priority ASC, created_at ASC';
  const lim = limit || 100;
  const off = offset || 0;

  const tasks = db.prepare(`SELECT * FROM tasks ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, lim, off);
  const total = db.prepare(`SELECT COUNT(*) as count FROM tasks ${where}`).get(...params).count;

  return {
    tasks: tasks.map(t => { t.tags = JSON.parse(t.tags || '[]'); return t; }),
    total,
    limit: lim,
    offset: off
  };
}

function updateTask(id, updates) {
  const db = getDb();
  const allowed = ['title', 'description', 'owner', 'assignee', 'status', 'priority', 'category', 'section', 'tags', 'due_date'];
  const sets = [];
  const params = [];

  for (const [key, val] of Object.entries(updates)) {
    if (!allowed.includes(key)) continue;
    if (key === 'tags') {
      sets.push('tags = ?');
      params.push(JSON.stringify(val));
    } else {
      sets.push(`${key} = ?`);
      params.push(val);
    }
  }

  if (updates.status === 'completed') {
    sets.push("completed_at = datetime('now')");
  }

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getTask(id);
}

function deleteTask(id) {
  const db = getDb();
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

// --- MESSAGES (per-task conversation thread) ---

function addMessage(taskId, { author, type, content }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO task_messages (task_id, author, type, content)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(taskId, author, type || 'update', content);
  // Touch the task's updated_at
  db.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").run(taskId);
  return db.prepare('SELECT * FROM task_messages WHERE id = ?').get(result.lastInsertRowid);
}

function getMessages(taskId) {
  const db = getDb();
  return db.prepare('SELECT * FROM task_messages WHERE task_id = ? ORDER BY created_at ASC').all(taskId);
}

// --- WATCHERS ---

function addWatcher(taskId, watcher) {
  const db = getDb();
  try {
    db.prepare('INSERT OR IGNORE INTO task_watchers (task_id, watcher) VALUES (?, ?)').run(taskId, watcher);
  } catch (e) { /* already watching */ }
}

function removeWatcher(taskId, watcher) {
  const db = getDb();
  db.prepare('DELETE FROM task_watchers WHERE task_id = ? AND watcher = ?').run(taskId, watcher);
}

// --- SEARCH ---

function searchTasks(query) {
  const db = getDb();
  const tasks = db.prepare(`
    SELECT tasks.* FROM tasks_fts
    JOIN tasks ON tasks_fts.rowid = tasks.id
    WHERE tasks_fts MATCH ?
    ORDER BY rank
    LIMIT 50
  `).all(query);
  return tasks.map(t => { t.tags = JSON.parse(t.tags || '[]'); return t; });
}

// --- QUEUE VIEWS ---

function getQueue(owner) {
  const db = getDb();
  const pending = db.prepare("SELECT * FROM tasks WHERE (owner = ? OR assignee = ?) AND status = 'pending' ORDER BY priority ASC").all(owner, owner);
  const inProgress = db.prepare("SELECT * FROM tasks WHERE (owner = ? OR assignee = ?) AND status = 'in_progress' ORDER BY priority ASC").all(owner, owner);
  const blocked = db.prepare("SELECT * FROM tasks WHERE (owner = ? OR assignee = ?) AND status = 'blocked' ORDER BY priority ASC").all(owner, owner);
  const recentlyCompleted = db.prepare("SELECT * FROM tasks WHERE (owner = ? OR assignee = ?) AND status = 'completed' ORDER BY completed_at DESC LIMIT 10").all(owner, owner);

  const parse = tasks => tasks.map(t => { t.tags = JSON.parse(t.tags || '[]'); return t; });

  return {
    owner,
    pending: parse(pending),
    in_progress: parse(inProgress),
    blocked: parse(blocked),
    recently_completed: parse(recentlyCompleted),
    counts: {
      pending: pending.length,
      in_progress: inProgress.length,
      blocked: blocked.length,
      total_open: pending.length + inProgress.length + blocked.length
    }
  };
}

function getPriorities() {
  const db = getDb();
  const byPriority = db.prepare(`
    SELECT priority, status, COUNT(*) as count
    FROM tasks WHERE status != 'completed' AND status != 'cancelled'
    GROUP BY priority, status
    ORDER BY priority ASC
  `).all();

  const byOwner = db.prepare(`
    SELECT owner, status, COUNT(*) as count
    FROM tasks WHERE status != 'completed' AND status != 'cancelled'
    GROUP BY owner, status
    ORDER BY owner
  `).all();

  const blockers = db.prepare(`
    SELECT * FROM tasks WHERE status = 'blocked'
    ORDER BY priority ASC
  `).all().map(t => { t.tags = JSON.parse(t.tags || '[]'); return t; });

  return { byPriority, byOwner, blockers };
}

function getStats() {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
  const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status').all();
  const byOwner = db.prepare("SELECT owner, COUNT(*) as count FROM tasks WHERE status != 'completed' GROUP BY owner ORDER BY count DESC").all();
  const byPriority = db.prepare("SELECT priority, COUNT(*) as count FROM tasks WHERE status != 'completed' GROUP BY priority ORDER BY priority").all();
  const recentMessages = db.prepare(`SELECT COUNT(*) as count FROM task_messages WHERE created_at > datetime('now', '-24 hours')`).get().count;
  const completedToday = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE completed_at > date('now')").get().count;

  return { total, byStatus, byOwner, byPriority, recentMessages, completedToday };
}

function close() {
  if (_db) { _db.close(); _db = null; }
}

module.exports = {
  getDb, close, DB_PATH,
  createTask, getTask, listTasks, updateTask, deleteTask,
  addMessage, getMessages,
  addWatcher, removeWatcher,
  searchTasks, getQueue, getPriorities, getStats
};
