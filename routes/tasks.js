// /api/tasks/* — Task exchange between Hearth and Anvil
// Serves TASKS.md, ANVIL-QUEUE, and agent-protocol as structured data
const fs = require('fs');
const path = require('path');
const os = require('os');

const TASKS_PATH = path.join(os.homedir(), '.claude', 'TASKS.md');
const QUEUE_PATH = path.join(os.homedir(), '.claude', 'ANVIL-QUEUE.md');
const PROTOCOL_PATH = path.join(os.homedir(), 'agent-protocol.md');

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function parseAnvilQueue(content) {
  if (!content) return { pending: [], inProgress: [], completed: [] };
  const sections = { pending: [], inProgress: [], completed: [] };
  let current = null;
  for (const line of content.split('\n')) {
    if (/^## Pending/i.test(line)) { current = 'pending'; continue; }
    if (/^## In Progress/i.test(line)) { current = 'inProgress'; continue; }
    if (/^## Completed/i.test(line)) { current = 'completed'; continue; }
    if (current && /^- /.test(line)) {
      sections[current].push(line.replace(/^- /, '').trim());
    }
  }
  return sections;
}

function extractAnvilWorkloadQueue(tasksContent) {
  if (!tasksContent) return [];
  const items = [];
  let inSection = false;
  for (const line of tasksContent.split('\n')) {
    if (/ANVIL WORKLOAD QUEUE/i.test(line)) { inSection = true; continue; }
    if (inSection && /^---/.test(line)) break;
    if (inSection && /^\d+\./.test(line)) {
      const done = /~~.*~~/.test(line) || /DONE/i.test(line);
      const text = line.replace(/^\d+\.\s*/, '').replace(/~~(.*?)~~/g, '$1').trim();
      items.push({ text, done });
    }
  }
  return items;
}

function register(router) {
  // Full TASKS.md as raw text
  router.get('/api/tasks', (req, params) => {
    const content = readFile(TASKS_PATH);
    if (!content) return { status: 404, body: { error: 'TASKS.md not found' } };
    return { status: 200, body: { path: TASKS_PATH, content, updated: fs.statSync(TASKS_PATH).mtime.toISOString() } };
  });

  // Anvil-specific workload from TASKS.md
  router.get('/api/tasks/anvil', (req, params) => {
    const tasks = readFile(TASKS_PATH);
    const queue = readFile(QUEUE_PATH);
    const workload = extractAnvilWorkloadQueue(tasks);
    const anvilQueue = parseAnvilQueue(queue);
    return {
      status: 200,
      body: {
        workload,
        queue: anvilQueue,
        pending: workload.filter(w => !w.done).length,
        done: workload.filter(w => w.done).length,
        queuePath: QUEUE_PATH,
        tasksPath: TASKS_PATH,
      }
    };
  });

  // ANVIL-QUEUE.md raw
  router.get('/api/tasks/queue', (req, params) => {
    const content = readFile(QUEUE_PATH);
    if (!content) return { status: 404, body: { error: 'ANVIL-QUEUE.md not found' } };
    return { status: 200, body: { path: QUEUE_PATH, content, updated: fs.statSync(QUEUE_PATH).mtime.toISOString() } };
  });

  // Agent protocol summary
  router.get('/api/tasks/agents', (req, params) => {
    const content = readFile(PROTOCOL_PATH);
    if (!content) return { status: 404, body: { error: 'agent-protocol.md not found' } };
    // Extract active agents table
    const lines = content.split('\n');
    const agents = [];
    let inTable = false;
    for (const line of lines) {
      if (/^\| Agent \| Name/.test(line)) { inTable = true; continue; }
      if (inTable && /^\|---/.test(line)) continue;
      if (inTable && /^\|/.test(line)) {
        const cols = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cols.length >= 6) {
          agents.push({ agent: cols[0], name: cols[1], model: cols[2], interface: cols[3], status: cols[4], focus: cols[5] });
        }
      } else if (inTable) break;
    }
    return { status: 200, body: { agents, count: agents.length, active: agents.filter(a => a.status === 'Active').length } };
  });
}

module.exports = { register };
