// /api/agents/* — Agent coordination state endpoints
const fs = require('fs');
const path = require('path');

const PROTOCOL_PATH = path.join(process.env.HOME, 'agent-protocol.md');
const SESSION_LOGS_DIR = path.join(process.env.HOME, '.claude/session-logs');
const COLLAB_BRIEF = path.join(process.env.HOME, 'claude-collab-brief.md');

function register(router) {
  // Current coordination protocol
  router.get('/api/agents/protocol', (req, params) => {
    if (!fs.existsSync(PROTOCOL_PATH)) {
      return { status: 404, body: { error: 'No agent-protocol.md found' } };
    }
    const content = fs.readFileSync(PROTOCOL_PATH, 'utf8');
    return { status: 200, body: { path: PROTOCOL_PATH, content } };
  });

  // List session logs
  router.get('/api/agents/sessions', (req, params) => {
    if (!fs.existsSync(SESSION_LOGS_DIR)) {
      return { status: 200, body: { sessions: [] } };
    }
    const logs = fs.readdirSync(SESSION_LOGS_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const stat = fs.statSync(path.join(SESSION_LOGS_DIR, f));
        return { name: f, modified: stat.mtime.toISOString(), sizeBytes: stat.size };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return { status: 200, body: { sessions: logs } };
  });

  // Read a specific session log
  router.get('/api/agents/sessions/:name', (req, params) => {
    const logPath = path.join(SESSION_LOGS_DIR, params.name);
    if (!logPath.startsWith(SESSION_LOGS_DIR)) return { status: 400, body: { error: 'Invalid path' } };
    if (!fs.existsSync(logPath)) return { status: 404, body: { error: 'Session log not found' } };
    return { status: 200, body: { name: params.name, content: fs.readFileSync(logPath, 'utf8') } };
  });

  // Collaboration brief
  router.get('/api/agents/collab-brief', (req, params) => {
    if (!fs.existsSync(COLLAB_BRIEF)) {
      return { status: 404, body: { error: 'No claude-collab-brief.md found' } };
    }
    return { status: 200, body: { content: fs.readFileSync(COLLAB_BRIEF, 'utf8') } };
  });
}

module.exports = { register };
