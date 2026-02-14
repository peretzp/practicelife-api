// /api/system/* — System state endpoints (mirrors life-dashboard logic)
const { execSync } = require('child_process');

function run(cmd, timeout = 5000) {
  try {
    return execSync(cmd, { timeout, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function register(router) {
  router.get('/api/system/state', (req, params) => {
    const os = require('os');
    const disk = run("df -h / | awk 'NR==2{print $5}'");
    const diskFree = run("df -h / | awk 'NR==2{print $4}'");
    const uptime = run('uptime');
    const loadAvg = os.loadavg();

    return {
      status: 200,
      body: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        totalMemoryGB: Math.round(os.totalmem() / 1073741824),
        freeMemoryGB: Math.round(os.freemem() / 1073741824 * 10) / 10,
        diskUsed: disk,
        diskFree: diskFree,
        uptime: uptime,
        loadAvg: { '1m': loadAvg[0], '5m': loadAvg[1], '15m': loadAvg[2] },
      }
    };
  });

  router.get('/api/system/volumes', (req, params) => {
    const raw = run('ls /Volumes/');
    const volumes = raw ? raw.split('\n').filter(Boolean) : [];
    return { status: 200, body: { volumes } };
  });

  router.get('/api/system/usage', (req, params) => {
    const usageJson = run('node /Users/peretz_1/.claude/prompt-store.js usage 2>/dev/null', 10000);
    if (!usageJson) return { status: 200, body: { error: 'Usage data unavailable' } };
    try {
      return { status: 200, body: JSON.parse(usageJson) };
    } catch {
      return { status: 200, body: { error: 'Parse error' } };
    }
  });

  router.get('/api/system/ollama', (req, params) => {
    const models = run('ollama list 2>/dev/null');
    if (!models) return { status: 200, body: { available: false, models: [] } };
    const lines = models.split('\n').slice(1).filter(Boolean);
    const parsed = lines.map(line => {
      const parts = line.split(/\s+/);
      return { name: parts[0], size: parts[2], modified: parts[3] };
    });
    return { status: 200, body: { available: true, models: parsed } };
  });
}

module.exports = { register };
