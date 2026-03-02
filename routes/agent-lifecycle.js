// /api/agents/lifecycle/* — Agent spawn/park/health management
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SESSION_LOGS_DIR = path.join(process.env.HOME, '.claude/session-logs');
const PROTOCOL_PATH = path.join(process.env.HOME, 'agent-protocol.md');
const PROMPT_STORE = path.join(process.env.HOME, '.claude/prompts.db');

function run(cmd, timeout = 5000) {
  try {
    return execSync(cmd, { timeout, encoding: 'utf8' }).trim();
  } catch (e) {
    return '';
  }
}

// Parse agent-protocol.md to extract active agents
function getActiveAgents() {
  if (!fs.existsSync(PROTOCOL_PATH)) return [];

  const content = fs.readFileSync(PROTOCOL_PATH, 'utf8');
  const activeSection = content.match(/## Active Agents\n\n\|[^\n]+\n\|[^\n]+\n((?:\|[^\n]+\n)+)/);

  if (!activeSection) return [];

  const rows = activeSection[1].trim().split('\n');
  return rows.map(row => {
    const cells = row.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 6) {
      return {
        id: cells[0],
        name: cells[1],
        model: cells[2],
        interface: cells[3],
        status: cells[4],
        focus: cells[5]
      };
    }
    return null;
  }).filter(Boolean);
}

// Get running Claude Code processes (heuristic: look for node processes with claude-related patterns)
function getRunningAgentProcesses() {
  try {
    // Look for processes that might be Claude Code instances
    const psOutput = run('ps aux | grep -E "(claude|sonnet|opus)" | grep -v grep', 10000);
    const lines = psOutput.split('\n').filter(l => l.trim());

    return lines.map(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) return null;

      return {
        user: parts[0],
        pid: parts[1],
        cpu: parts[2],
        mem: parts[3],
        command: parts.slice(10).join(' ')
      };
    }).filter(Boolean);
  } catch (e) {
    return [];
  }
}

// Parse recent session logs to find active agents
function getActiveAgentSessions() {
  if (!fs.existsSync(SESSION_LOGS_DIR)) return [];

  const logs = fs.readdirSync(SESSION_LOGS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const logPath = path.join(SESSION_LOGS_DIR, f);
      const stat = fs.statSync(logPath);
      const content = fs.readFileSync(logPath, 'utf8');

      // Extract agent name from log
      const nameMatch = content.match(/\*\*Agent\*\*:\s*(.+?)(?:\n|$)/i) ||
                        content.match(/\*\*Instance\*\*:\s*(.+?)(?:\n|$)/i) ||
                        content.match(/^# Session Log:\s*[\d-]+\s*—\s*(.+?)(?:\n|$)/m);

      const statusMatch = content.match(/\*\*Status\*\*:\s*(.+?)(?:\n|$)/i);
      const focusMatch = content.match(/\*\*Focus\*\*:\s*(.+?)(?:\n|$)/i);
      const modelMatch = content.match(/\(([^)]*(?:Sonnet|Opus|Haiku)[^)]*)\)/i);

      // Check if log was updated recently (within last hour = likely active)
      const ageMs = Date.now() - stat.mtime.getTime();
      const isRecentlyActive = ageMs < 3600000; // 1 hour

      return {
        logFile: f,
        agentName: nameMatch ? nameMatch[1].trim() : 'Unknown',
        status: statusMatch ? statusMatch[1].trim() : 'Unknown',
        focus: focusMatch ? focusMatch[1].trim() : '',
        model: modelMatch ? modelMatch[1].trim() : '',
        lastModified: stat.mtime.toISOString(),
        ageMs,
        isRecentlyActive
      };
    })
    .sort((a, b) => b.lastModified.localeCompare(a.lastModified));

  return logs;
}

// Aggregate agent health from multiple sources
function getAgentHealth() {
  const protocolAgents = getActiveAgents();
  const processAgents = getRunningAgentProcesses();
  const sessionAgents = getActiveAgentSessions();

  // Merge data from multiple sources
  const healthMap = new Map();

  // Add agents from protocol
  protocolAgents.forEach(agent => {
    healthMap.set(agent.name, {
      name: agent.name,
      id: agent.id,
      model: agent.model,
      status: agent.status,
      focus: agent.focus,
      source: 'protocol',
      protocolStatus: agent.status
    });
  });

  // Enrich with session log data
  sessionAgents.filter(s => s.isRecentlyActive).forEach(session => {
    const existing = Array.from(healthMap.values()).find(a =>
      a.name === session.agentName || session.agentName.includes(a.name)
    );

    if (existing) {
      existing.lastActivity = session.lastModified;
      existing.sessionLog = session.logFile;
      existing.ageMs = session.ageMs;
    } else {
      // Agent active in logs but not in protocol (possibly new/unregistered)
      healthMap.set(session.agentName, {
        name: session.agentName,
        model: session.model,
        status: session.status,
        focus: session.focus,
        lastActivity: session.lastModified,
        sessionLog: session.logFile,
        ageMs: session.ageMs,
        source: 'session-log',
        protocolStatus: null
      });
    }
  });

  return {
    agents: Array.from(healthMap.values()),
    summary: {
      total: healthMap.size,
      active: Array.from(healthMap.values()).filter(a => a.status === 'Active').length,
      parked: Array.from(healthMap.values()).filter(a => a.status === 'Parked').length,
      recentlyActive: Array.from(healthMap.values()).filter(a => a.ageMs && a.ageMs < 3600000).length
    },
    processes: processAgents,
    timestamp: new Date().toISOString()
  };
}

function register(router) {
  // GET /api/agents/health — Comprehensive agent health check
  router.get('/api/agents/health', (req, params) => {
    const health = getAgentHealth();
    return { status: 200, body: health };
  });

  // GET /api/agents/active — List active agents (simplified)
  router.get('/api/agents/active', (req, params) => {
    const health = getAgentHealth();
    const active = health.agents.filter(a =>
      a.status === 'Active' || (a.ageMs && a.ageMs < 3600000)
    );
    return {
      status: 200,
      body: {
        active,
        count: active.length,
        timestamp: health.timestamp
      }
    };
  });

  // POST /api/agents/spawn — Spawn new agent (placeholder)
  router.post('/api/agents/spawn', (req, params) => {
    // TODO: Implement agent spawning via AppleScript/iTerm automation
    // For now, return 501 Not Implemented with instructions
    return {
      status: 501,
      body: {
        error: 'Agent spawning not yet implemented',
        instructions: 'Use: open new iTerm tab → type `cc` → provide agent directive',
        planned: {
          method: 'AppleScript automation',
          params: ['agentName', 'model', 'focus', 'prompt'],
          example: {
            agentName: 'The Watcher',
            model: 'sonnet',
            focus: 'System monitoring',
            prompt: 'Monitor services and report anomalies'
          }
        }
      }
    };
  });

  // POST /api/agents/park — Park running agent (placeholder)
  router.post('/api/agents/park', (req, params) => {
    return {
      status: 501,
      body: {
        error: 'Agent parking not yet implemented',
        instructions: 'Use: tell agent to execute /park protocol or type "park"',
        planned: {
          method: 'Send park command to agent via API or stdin',
          params: ['agentName or PID'],
          actions: [
            'Update session log',
            'Rebuild indexes',
            'Create handoff entry',
            'Update agent-protocol.md status to Parked'
          ]
        }
      }
    };
  });

  // POST /api/agents/handoff — Create handoff entry programmatically
  router.post('/api/agents/handoff', (req, params) => {
    return {
      status: 501,
      body: {
        error: 'Handoff creation not yet implemented',
        instructions: 'Manually append to ~/agent-protocol.md ## Handoffs section',
        planned: {
          method: 'Append to agent-protocol.md',
          params: ['agentName', 'timestamp', 'whatChanged', 'whatsNext', 'blockers'],
          template: '### {agentName} — {timestamp} — {title}\n\n**What changed**: ...\n**What\'s next**: ...\n**Blockers**: ...'
        }
      }
    };
  });
}

module.exports = { register, getAgentHealth, getActiveAgents };
