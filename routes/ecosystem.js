/**
 * PracticeLife OS Ecosystem Map — Self-Documenting System Reference
 *
 * This endpoint provides a living map of all services, agents, schedulers,
 * and infrastructure that comprises the PracticeLife OS.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim();
  } catch {
    return null;
  }
}

function checkPort(port) {
  const result = run(`lsof -ti:${port}`);
  return result !== null && result.length > 0;
}

function getAgentProtocol() {
  try {
    const protocolPath = path.join(process.env.HOME, 'agent-protocol.md');
    const content = fs.readFileSync(protocolPath, 'utf8');

    // Parse Active Agents table
    const agentTableMatch = content.match(/## Active Agents[\s\S]*?\|[-\s|]+\|([\s\S]*?)(?=\n##)/);
    const agents = [];

    if (agentTableMatch) {
      const rows = agentTableMatch[1].trim().split('\n').filter(r => r.includes('|'));
      for (const row of rows) {
        const cols = row.split('|').map(c => c.trim()).filter(Boolean);
        if (cols.length >= 6) {
          agents.push({
            id: cols[0],
            name: cols[1],
            model: cols[2],
            interface: cols[3],
            status: cols[4].toLowerCase(),
            focus: cols[5]
          });
        }
      }
    }

    return agents;
  } catch {
    return [];
  }
}

function getLaunchAgents() {
  const launchAgentDir = path.join(process.env.HOME, 'Library/LaunchAgents');
  const agents = [];

  try {
    const files = fs.readdirSync(launchAgentDir).filter(f => f.endsWith('.plist'));

    for (const file of files) {
      const label = file.replace('.plist', '');
      const isLoaded = run(`launchctl list | grep ${label}`) !== null;

      agents.push({
        name: label,
        type: 'LaunchAgent',
        file: path.join(launchAgentDir, file),
        status: isLoaded ? 'loaded' : 'unloaded'
      });
    }
  } catch {
    // Directory might not exist or be readable
  }

  return agents;
}

function getSessionLogs() {
  const logsDir = path.join(process.env.HOME, '.claude/session-logs');
  try {
    const logs = fs.readdirSync(logsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const stat = fs.statSync(path.join(logsDir, f));
        return {
          name: f.replace('.md', ''),
          path: path.join(logsDir, f),
          modified: stat.mtime.toISOString()
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified))
      .slice(0, 10); // Latest 10

    return logs;
  } catch {
    return [];
  }
}

function getEcosystemMap() {
  const agents = getAgentProtocol();
  const launchAgents = getLaunchAgents();
  const sessionLogs = getSessionLogs();

  // Check service status
  const dashboardUp = checkPort(3000);
  const apiUp = checkPort(3001);
  const promptBrowserUp = checkPort(3002);

  return {
    meta: {
      name: "PracticeLife OS",
      tagline: "The Machine Is the Context",
      version: "Ω₀",
      updated: new Date().toISOString(),
      machine: {
        model: "Mac Studio Pro",
        chip: "M2 Max",
        ram: "64GB",
        os: "macOS Darwin 25.2.0",
        displays: "3x 4K"
      }
    },

    services: [
      {
        name: "Life Dashboard",
        refrant: "dashboard",
        port: 3000,
        url: "http://localhost:3000",
        status: dashboardUp ? "running" : "stopped",
        purpose: "Master dashboard — system state, task progress, agent activity",
        endpoints: [
          { path: "/", description: "Main dashboard UI" },
          { path: "/stream", description: "Life Stream — 15 data sources (messages, photos, browsing, vault, health)" },
          { path: "/plan", description: "Plan Tracker — Tentacle execution waves" },
          { path: "/api/state", description: "JSON system state" }
        ],
        repository: "https://github.com/peretzp/life-dashboard",
        location: "~/life-dashboard/server.js"
      },
      {
        name: "PracticeLife API",
        refrant: "api",
        port: 3001,
        url: "http://localhost:3001",
        status: apiUp ? "running" : "stopped",
        purpose: "Central API — vault, atlas, agents, system queries",
        endpoints: [
          { path: "/health", description: "Health check" },
          { path: "/api/vault/notes", description: "List vault notes" },
          { path: "/api/vault/note/:notePath", description: "Read specific note" },
          { path: "/api/atlas/status", description: "MemoryAtlas status" },
          { path: "/api/atlas/memos", description: "List voice memos" },
          { path: "/api/system/info", description: "System information" },
          { path: "/api/agents", description: "Active agents from protocol" },
          { path: "/api/ecosystem", description: "This endpoint — full system map" }
        ],
        repository: "https://github.com/peretzp/practicelife-api",
        location: "~/api/server.js"
      },
      {
        name: "Prompt Browser",
        refrant: "prompts",
        port: 3002,
        url: "http://localhost:3002",
        status: promptBrowserUp ? "running" : "stopped",
        purpose: "Search and browse all prompts sent to Claude",
        endpoints: [
          { path: "/", description: "Prompt browser UI" },
          { path: "/api/stats", description: "Prompt database stats" },
          { path: "/api/search", description: "Full-text search prompts" },
          { path: "/api/sessions", description: "List all sessions" }
        ],
        repository: "https://github.com/peretzp/prompt-browser",
        location: "~/prompt-browser/server.js",
        database: "~/.claude/prompts.db"
      }
    ],

    schedulers: [
      {
        name: "Chrome Tab Capture",
        refrant: "tab-capture",
        type: "LaunchAgent",
        interval: "5 minutes",
        purpose: "Captures all open Chrome tabs to ~/.life-capture/tabs/",
        script: "~/.life-capture/chrome-tab-capture.sh",
        output: "~/.life-capture/tabs/*.json",
        status: launchAgents.find(a => a.name.includes('tab-capture'))?.status || 'unknown'
      },
      {
        name: "Dashboard Auto-Restart",
        refrant: "dashboard-launcher",
        type: "LaunchAgent",
        interval: "on login + keepalive",
        purpose: "Auto-starts life-dashboard on login, restarts on crash",
        script: "~/life-dashboard/server.js",
        status: launchAgents.find(a => a.name.includes('dashboard'))?.status || 'unknown'
      },
      {
        name: "MemoryAtlas Transcription",
        refrant: "memoryatlas-batch",
        type: "Background Process",
        interval: "continuous (one-time batch)",
        purpose: "Transcribing 929 voice memos with mlx-whisper turbo",
        status: run('ps aux | grep -i "mlx-whisper" | grep -v grep') ? 'running' : 'stopped',
        progress: "Check: tail -f ~/tools/memoryatlas/data/transcribe-batch.log"
      }
    ],

    agents: agents.map(agent => ({
      name: agent.name,
      refrant: agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      type: agent.interface,
      model: agent.model,
      status: agent.status,
      focus: agent.focus,
      sessionLog: agent.status === 'active' ?
        sessionLogs.find(log => log.name.includes(agent.name.toLowerCase().split(' ').pop()))?.path :
        null
    })),

    infrastructure: {
      vault: {
        name: "Obsidian Vault",
        refrant: "vault",
        path: path.join(process.env.HOME, 'Library/Mobile Documents/iCloud~md~obsidian/Documents/PracticeLife'),
        structure: [
          "Atlas/ — People, Concepts, Maps",
          "Claude/ — Agent coordination files",
          "Dashboards/ — Home.md (master dashboard)",
          "Efforts/ — Active, Areas, Simmering, Archive",
          "Journal/ — Daily, Weekly, Monthly, Quarterly, Sessions",
          "MemoryAtlas/ — voice/ (929 memos)",
          "Resources/ — Systems, Templates, Reference"
        ],
        notes: "2,600+ markdown files",
        plugins: ["calendar", "dataview", "templater", "periodic-notes", "quickadd", "tasks", "kanban"]
      },

      memoryAtlas: {
        name: "MemoryAtlas",
        refrant: "atlas",
        purpose: "Voice memo → transcription → Obsidian notes",
        cli: "source ~/tools/memoryatlas/.venv/bin/activate && atlas status",
        database: "~/tools/memoryatlas/data/atlas.db",
        stats: {
          total: 929,
          transcribed: "Check: atlas status",
          published: "Check: atlas status"
        }
      },

      sessionLogs: {
        name: "Session Logs",
        refrant: "sessions",
        path: path.join(process.env.HOME, '.claude/session-logs'),
        purpose: "Continuous record of all Claude interactions",
        index: path.join(process.env.HOME, '.claude/session-index.db'),
        search: "node ~/.claude/session-index.js search 'query'",
        latest: sessionLogs.slice(0, 5)
      },

      promptStore: {
        name: "Prompt Store",
        refrant: "prompt-store",
        path: path.join(process.env.HOME, '.claude/prompts.db'),
        purpose: "SQLite FTS5 index of every prompt sent to Claude",
        commands: [
          "node ~/.claude/prompt-store.js rebuild",
          "node ~/.claude/prompt-store.js verify",
          "node ~/.claude/prompt-store.js search 'query'",
          "node ~/.claude/prompt-store.js stats"
        ]
      },

      agentProtocol: {
        name: "Agent Protocol",
        refrant: "protocol",
        path: path.join(process.env.HOME, 'agent-protocol.md'),
        purpose: "Multi-agent coordination — file ownership, handoffs, proposals",
        activeAgents: agents.filter(a => a.status === 'active').length,
        parkedAgents: agents.filter(a => a.status === 'parked').length
      },

      lifeCapture: {
        name: "Life Capture",
        refrant: "life-capture",
        path: path.join(process.env.HOME, '.life-capture'),
        purpose: "Continuous memory externalization — browsing, tabs, messages, photos",
        sources: [
          "Chrome history (29,446 URLs, 2020-2026)",
          "Safari history (5,552 URLs)",
          "Tab snapshots (every 5 min)",
          "Messages (376K messages)",
          "Photos (209K photos)",
          "Calendar (425 daily notes backfilled)"
        ],
        nextPhase: "Google Calendar integration (OAuth pending)"
      }
    },

    keyPaths: {
      home: process.env.HOME,
      vault: path.join(process.env.HOME, 'Library/Mobile Documents/iCloud~md~obsidian/Documents/PracticeLife'),
      vaultDashboard: path.join(process.env.HOME, 'Library/Mobile Documents/iCloud~md~obsidian/Documents/PracticeLife/Dashboards/Home.md'),
      claudeConfig: path.join(process.env.HOME, '.claude'),
      sessionLogs: path.join(process.env.HOME, '.claude/session-logs'),
      agentProtocol: path.join(process.env.HOME, 'agent-protocol.md'),
      memoryAtlas: path.join(process.env.HOME, 'tools/memoryatlas'),
      lifeCapture: path.join(process.env.HOME, '.life-capture'),
      api: path.join(process.env.HOME, 'api'),
      dashboard: path.join(process.env.HOME, 'life-dashboard'),
      promptBrowser: path.join(process.env.HOME, 'prompt-browser')
    },

    quickCommands: {
      services: {
        start: [
          "cd ~/life-dashboard && node server.js &",
          "cd ~/api && node server.js &",
          "cd ~/prompt-browser && node server.js &"
        ],
        restart: "restart-services  # shell helper",
        status: "status  # shell helper"
      },
      atlas: {
        status: "source ~/tools/memoryatlas/.venv/bin/activate && atlas status",
        scan: "atlas scan",
        publish: "atlas publish"
      },
      sessions: {
        latest: "node ~/.claude/session-index.js latest",
        search: "node ~/.claude/session-index.js search 'query'",
        rebuild: "node ~/.claude/session-index.js rebuild"
      },
      prompts: {
        verify: "node ~/.claude/prompt-store.js verify",
        search: "node ~/.claude/prompt-store.js search 'query'",
        rebuild: "node ~/.claude/prompt-store.js rebuild"
      }
    }
  };
}

function register(router) {
  router.get('/api/ecosystem', (req, params) => {
    try {
      const ecosystem = getEcosystemMap();
      return { status: 200, body: ecosystem };
    } catch (err) {
      return { status: 500, body: { error: err.message } };
    }
  });
}

module.exports = { register };
