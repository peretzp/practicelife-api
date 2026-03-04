// /api/q/* — Unified Task Queue API
// Async job queue with conversation threads, priorities, and multi-owner support
// Owners: peretz, kevin, any agent name

const taskdb = require('../lib/taskdb');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Backward compat: still serve file-based TASKS.md at old endpoints
const TASKS_PATH = path.join(os.homedir(), '.claude', 'TASKS.md');

function register(router) {

  // --- TASK CRUD ---

  // List tasks (with filters)
  // GET /api/q/tasks?owner=peretz&status=open&priority=1&category=time-sensitive&limit=50&offset=0&sort=updated
  router.get('/api/q/tasks', (req) => {
    const url = new URL(req.url, 'http://localhost');
    const filters = {
      owner: url.searchParams.get('owner'),
      assignee: url.searchParams.get('assignee'),
      status: url.searchParams.get('status'),
      priority: url.searchParams.get('priority') ? parseInt(url.searchParams.get('priority')) : null,
      category: url.searchParams.get('category'),
      source: url.searchParams.get('source'),
      limit: url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')) : 100,
      offset: url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')) : 0,
      sort: url.searchParams.get('sort'),
    };
    const result = taskdb.listTasks(filters);
    return { status: 200, body: result };
  });

  // Create task
  // POST /api/q/tasks { title, description, owner, assignee, priority, source, category, tags, due_date }
  router.post('/api/q/tasks', (req) => {
    const { title, description, owner, assignee, priority, source, category, section, tags, due_date } = req.body || {};
    if (!title) return { status: 400, body: { error: 'title is required' } };
    const task = taskdb.createTask({ title, description, owner, assignee, priority, source, category, section, tags, due_date });
    return { status: 201, body: task };
  });

  // Get single task (with thread)
  // GET /api/q/tasks/:id
  router.get('/api/q/tasks/:id', (req, params) => {
    const task = taskdb.getTask(parseInt(params.id));
    if (!task) return { status: 404, body: { error: 'Task not found' } };
    return { status: 200, body: task };
  });

  // Update task
  // PATCH /api/q/tasks/:id { status, priority, assignee, ... }
  router.patch('/api/q/tasks/:id', (req, params) => {
    const id = parseInt(params.id);
    const existing = taskdb.getTask(id);
    if (!existing) return { status: 404, body: { error: 'Task not found' } };
    const task = taskdb.updateTask(id, req.body || {});
    return { status: 200, body: task };
  });

  // Delete task
  // DELETE /api/q/tasks/:id
  router.delete('/api/q/tasks/:id', (req, params) => {
    const id = parseInt(params.id);
    taskdb.deleteTask(id);
    return { status: 200, body: { deleted: id } };
  });

  // --- CONVERSATION THREAD ---

  // Add message to task thread
  // POST /api/q/tasks/:id/messages { author, type, content }
  // Types: update, question, answer, ack, clarification, note, blocker
  router.post('/api/q/tasks/:id/messages', (req, params) => {
    const id = parseInt(params.id);
    const task = taskdb.getTask(id);
    if (!task) return { status: 404, body: { error: 'Task not found' } };
    const { author, type, content } = req.body || {};
    if (!author || !content) return { status: 400, body: { error: 'author and content required' } };
    const msg = taskdb.addMessage(id, { author, type, content });
    return { status: 201, body: msg };
  });

  // Acknowledge receipt of a task
  // POST /api/q/tasks/:id/ack { agent }
  router.post('/api/q/tasks/:id/ack', (req, params) => {
    const id = parseInt(params.id);
    const task = taskdb.getTask(id);
    if (!task) return { status: 404, body: { error: 'Task not found' } };
    const { agent } = req.body || {};
    if (!agent) return { status: 400, body: { error: 'agent name required' } };
    // Add ack message and update assignee + status
    taskdb.addMessage(id, { author: agent, type: 'ack', content: `Task acknowledged by ${agent}` });
    const updated = taskdb.updateTask(id, { assignee: agent, status: 'in_progress' });
    return { status: 200, body: updated };
  });

  // --- QUEUE VIEWS ---

  // Get queue for a specific owner/person
  // GET /api/q/queue/:owner
  router.get('/api/q/queue/:owner', (req, params) => {
    const queue = taskdb.getQueue(params.owner);
    return { status: 200, body: queue };
  });

  // Priority overview across all queues
  // GET /api/q/priorities
  router.get('/api/q/priorities', (req) => {
    const priorities = taskdb.getPriorities();
    return { status: 200, body: priorities };
  });

  // Stats
  // GET /api/q/stats
  router.get('/api/q/stats', (req) => {
    const stats = taskdb.getStats();
    return { status: 200, body: stats };
  });

  // Search tasks and messages
  // GET /api/q/search?q=query
  router.get('/api/q/search', (req) => {
    const url = new URL(req.url, 'http://localhost');
    const q = url.searchParams.get('q');
    if (!q) return { status: 400, body: { error: 'q parameter required' } };
    const results = taskdb.searchTasks(q);
    return { status: 200, body: { query: q, results, count: results.length } };
  });

  // --- BACKWARD COMPAT: Import from TASKS.md ---

  // GET /api/q/import — import TASKS.md into the database (idempotent)
  router.post('/api/q/import', (req) => {
    try {
      const content = fs.readFileSync(TASKS_PATH, 'utf8');
      const imported = importTasksMd(content);
      return { status: 200, body: { imported: imported.length, tasks: imported } };
    } catch (e) {
      return { status: 500, body: { error: e.message } };
    }
  });
}

// Parse TASKS.md into structured tasks
function importTasksMd(content) {
  const imported = [];
  const lines = content.split('\n');
  let currentSection = null;
  let currentPriority = 3;
  let currentCategory = null;
  let taskBuffer = null;

  const sectionMap = {
    '1': { priority: 1, category: 'time-sensitive' },
    '2': { priority: 2, category: 'post-reboot' },
    '3': { priority: 3, category: 'review' },
    '4': { priority: 4, category: 'quick-action' },
    '5': { priority: 2, category: 'infrastructure' },
    '6': { priority: 3, category: 'data-work' },
    '7': { priority: 3, category: 'blocked' },
    '8': { priority: 5, category: 'someday' },
  };

  function flushTask() {
    if (!taskBuffer) return;
    // Determine owner from [PERETZ], [CLAUDE], [TOGETHER], [KEVIN]
    let owner = 'peretz';
    let assignee = null;
    const ownerMatch = taskBuffer.title.match(/\[(PERETZ|CLAUDE|TOGETHER|KEVIN)\]/i);
    if (ownerMatch) {
      const tag = ownerMatch[1].toUpperCase();
      if (tag === 'CLAUDE') { owner = 'peretz'; assignee = 'claude'; }
      else if (tag === 'KEVIN') { owner = 'kevin'; }
      else if (tag === 'TOGETHER') { owner = 'peretz'; assignee = 'together'; }
    }

    const isDone = taskBuffer.title.includes('DONE') || taskBuffer.title.includes('COMPLETE') || taskBuffer.title.startsWith('~~');
    const cleanTitle = taskBuffer.title
      .replace(/\[(PERETZ|CLAUDE|TOGETHER|KEVIN)\]\s*/gi, '')
      .replace(/—\s*(DONE|COMPLETE).*$/i, '')
      .replace(/~~(.*?)~~/g, '$1')
      .trim();

    const task = taskdb.createTask({
      title: cleanTitle,
      description: taskBuffer.body.trim() || null,
      owner,
      assignee,
      priority: taskBuffer.priority || currentPriority,
      source: 'import',
      category: taskBuffer.category || currentCategory,
      section: taskBuffer.section || currentSection,
      tags: taskBuffer.tags || [],
    });

    if (isDone) {
      taskdb.updateTask(task.id, { status: 'completed' });
    }

    imported.push(task);
    taskBuffer = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect section headers: ## 1. TIME-SENSITIVE, ## 2. POST-REBOOT, etc.
    const sectionMatch = line.match(/^## (\d+)\.\s+(.*)/);
    if (sectionMatch) {
      flushTask();
      const num = sectionMatch[1];
      currentSection = sectionMatch[2].trim();
      const mapping = sectionMap[num] || {};
      currentPriority = mapping.priority || 3;
      currentCategory = mapping.category || null;
      continue;
    }

    // Detect task headers: ### 1a. [PERETZ] Title
    const taskMatch = line.match(/^### \d+\w?\.\s+(.*)/);
    if (taskMatch) {
      flushTask();
      taskBuffer = {
        title: taskMatch[1].trim(),
        body: '',
        priority: currentPriority,
        category: currentCategory,
        section: currentSection,
        tags: [],
      };
      continue;
    }

    // Sub-section headers without ###
    const subMatch = line.match(/^## \d+\w?\.\s+(.*)/);
    if (subMatch && !sectionMatch) {
      flushTask();
      taskBuffer = {
        title: subMatch[1].trim(),
        body: '',
        priority: currentPriority,
        category: currentCategory,
        section: currentSection,
        tags: [],
      };
      continue;
    }

    // Accumulate body lines
    if (taskBuffer && line.trim()) {
      taskBuffer.body += line + '\n';
    }
  }

  flushTask();
  return imported;
}

module.exports = { register };
