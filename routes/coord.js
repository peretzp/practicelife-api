// /api/coord/* — Shared coordination write layer
// The cross-repo/agent spine: create tasks, append events, register agents,
// and read the aligned view. All endpoints are gated by a shared secret
// (this API otherwise has no auth), returning 401 when the secret is missing.

const taskdb = require('../lib/taskdb');
const coorddb = require('../lib/coorddb');
const { requireSecret } = require('../lib/coord-auth');

const UNAUTHORIZED = { status: 401, body: { error: 'unauthorized' } };

function register(router) {
  // Create a task and record a coordination event.
  // POST /api/coord/task { title, body?, priority?, source?, assignee?, watchers? }
  router.post('/api/coord/task', (req) => {
    if (!requireSecret(req)) return UNAUTHORIZED;
    const { title, body, priority, source, assignee, watchers } = req.body || {};
    if (!title) return { status: 400, body: { error: 'title is required' } };

    const task = taskdb.createTask({
      title,
      description: body || null,
      priority: priority || 3,
      source: source || 'coord',
      assignee: assignee || null,
    });

    if (assignee) taskdb.addWatcher(task.id, assignee);
    if (Array.isArray(watchers)) {
      for (const w of watchers) if (w) taskdb.addWatcher(task.id, w);
    }

    coorddb.appendEvent({
      source: source || 'coord',
      actor: assignee || null,
      kind: 'task',
      ref: String(task.id),
      summary: title,
      payload: { taskId: task.id, priority: task.priority, assignee: assignee || null },
    });

    return { status: 201, body: taskdb.getTask(task.id) };
  });

  // Append a coordination event.
  // POST /api/coord/event { source, actor?, kind, ref?, summary, payload? }
  router.post('/api/coord/event', (req) => {
    if (!requireSecret(req)) return UNAUTHORIZED;
    const { source, actor, kind, ref, summary, payload } = req.body || {};
    if (!source || !kind || !summary) {
      return { status: 400, body: { error: 'source, kind, and summary are required' } };
    }
    const event = coorddb.appendEvent({ source, actor, kind, ref, summary, payload });
    return { status: 201, body: event };
  });

  // Register / update an aligned agent or repo.
  // POST /api/coord/agent { name, kind?, machine?, repo?, endpoint?, meta? }
  router.post('/api/coord/agent', (req) => {
    if (!requireSecret(req)) return UNAUTHORIZED;
    const { name, kind, machine, repo, endpoint, meta } = req.body || {};
    if (!name) return { status: 400, body: { error: 'name is required' } };
    const agent = coorddb.upsertAgent({ name, kind, machine, repo, endpoint, meta });
    return { status: 201, body: agent };
  });

  // Aligned view — registry + recent events plus Peretz's open tasks.
  // GET /api/coord/state
  router.get('/api/coord/state', (req) => {
    if (!requireSecret(req)) return UNAUTHORIZED;
    const peretzId = process.env.PERETZ_SLACK_ID || 'U0B090UP4DV';
    const state = coorddb.getState();
    const peretzOpenTasks = taskdb.listTasks({ assignee: peretzId, status: 'open', limit: 100 }).tasks;
    return { status: 200, body: { ...state, peretzOpenTasks } };
  });
}

module.exports = { register };
