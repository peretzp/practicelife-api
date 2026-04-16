// /api/commands/* — Self-documenting command registry
// Auto-discovers scripts in ~/.local/bin/ and extracts documentation from headers
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BIN_DIR = path.join(process.env.HOME, '.local', 'bin');

function parseScript(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      return { type: 'symlink', target: fs.readlinkSync(filePath) };
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').slice(0, 30); // first 30 lines for docs

    // Detect language from shebang
    const shebang = lines[0] || '';
    let language = 'unknown';
    if (shebang.includes('python')) language = 'python';
    else if (shebang.includes('node')) language = 'node';
    else if (shebang.includes('zsh')) language = 'zsh';
    else if (shebang.includes('bash')) language = 'bash';
    else if (shebang.includes('sh')) language = 'sh';

    // Extract description from comment header
    let description = '';
    let usage = '';
    let examples = [];
    let author = '';
    let created = '';

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Stop at first non-comment, non-empty line (for shell scripts)
      if (language !== 'python' && language !== 'node' && !line.startsWith('#') && line.trim() !== '' && !line.startsWith('//') && !line.startsWith('/*') && !line.startsWith(' *') && !line.startsWith('"""')) {
        break;
      }

      const cleaned = line.replace(/^[#/*\s"]+/, '').trim();

      if (cleaned.toLowerCase().startsWith('usage:')) {
        usage = cleaned.substring(6).trim();
      } else if (cleaned.toLowerCase().startsWith('created:')) {
        created = cleaned.substring(8).trim();
      } else if (cleaned.match(/^by\s+the\s/i)) {
        author = cleaned;
      } else if (cleaned.startsWith('anvil-submit ') || cleaned.startsWith('moment ') || cleaned.startsWith('./')  || cleaned.match(/^\w+-\w+\s/)) {
        examples.push(cleaned);
      } else if (description === '' && cleaned.length > 5 && !cleaned.startsWith('!')) {
        description = cleaned;
      }
    }

    // For Python, also check __doc__
    if (language === 'python') {
      const docMatch = content.match(/"""([\s\S]*?)"""/);
      if (docMatch) {
        const docLines = docMatch[1].trim().split('\n');
        if (!description && docLines[0]) description = docLines[0].trim();
        for (const dl of docLines) {
          const dt = dl.trim();
          if (dt.toLowerCase().startsWith('usage:')) {
            usage = dt.substring(6).trim();
          } else if (dt.match(/^\w+\s+\w+/) && dt.length < 80 && !usage) {
            // Could be a usage example
          }
        }
      }
    }

    // For Node, check first JSDoc or block comment
    if (language === 'node') {
      const blockMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
      if (blockMatch) {
        const docLines = blockMatch[1].trim().split('\n');
        if (!description && docLines[0]) {
          description = docLines[0].replace(/^\s*\*\s*/, '').trim();
        }
      }
    }

    const mtime = stat.mtime.toISOString().slice(0, 10);
    const size = stat.size;

    return {
      type: 'script',
      language,
      description: description || '(no description)',
      usage: usage || null,
      examples: examples.length ? examples : null,
      author: author || null,
      created: created || null,
      modified: mtime,
      size,
    };
  } catch (e) {
    return { type: 'error', error: e.message };
  }
}

function register(router) {
  // Full command registry
  router.get('/api/commands', (req, params) => {
    const entries = fs.readdirSync(BIN_DIR);
    const commands = {};
    let scripts = 0, symlinks = 0;

    for (const name of entries.sort()) {
      if (name === 'node_modules' || name === 'package.json' || name === 'package-lock.json') continue;
      const fullPath = path.join(BIN_DIR, name);
      const info = parseScript(fullPath);
      commands[name] = info;
      if (info.type === 'script') scripts++;
      if (info.type === 'symlink') symlinks++;
    }

    // Group by category (inferred from name prefix)
    const categories = {};
    for (const [name, info] of Object.entries(commands)) {
      let cat = 'general';
      if (name.startsWith('fleet-')) cat = 'fleet';
      else if (name.startsWith('ai-') || name === 'claude-router' || name === 'litellm-proxy-with-keys') cat = 'ai';
      else if (name.startsWith('verify-') || name === 'hackmon') cat = 'verification';
      else if (name.includes('beeper') || name.includes('friend')) cat = 'messaging';
      else if (name.includes('vault') || name.includes('obsidian')) cat = 'vault';
      else if (name.startsWith('deploy-') || name === 'watch-services' || name === 'service-status') cat = 'services';
      else if (name === 'moment' || name === 'capture-index' || name === 'voice-verify') cat = 'capture';
      else if (name === 'anvil-submit' || name === 'download-daemon') cat = 'compute';
      else if (name === 'amazon-sns' || name === 'resume-update' || name === 'daily-burn-report') cat = 'personal';
      else if (name === 'ccc-sudo' || name === 'session-handoff') cat = 'system';

      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(name);
    }

    return {
      status: 200,
      body: {
        total: Object.keys(commands).length,
        scripts,
        symlinks,
        bin_dir: BIN_DIR,
        categories,
        commands,
      }
    };
  });

  // Documentation health — how well-documented are commands?
  // NOTE: Must be registered BEFORE :name route
  router.get('/api/commands/health', (req, params) => {
    const entries = fs.readdirSync(BIN_DIR);
    let total = 0, documented = 0, withUsage = 0, withAuthor = 0;
    const undocumented = [];

    for (const name of entries.sort()) {
      if (name === 'node_modules' || name === 'package.json' || name === 'package-lock.json') continue;
      const fullPath = path.join(BIN_DIR, name);
      const info = parseScript(fullPath);
      if (info.type !== 'script') continue;
      total++;
      if (info.description && info.description !== '(no description)') documented++;
      else undocumented.push(name);
      if (info.usage) withUsage++;
      if (info.author) withAuthor++;
    }

    return {
      status: 200,
      body: {
        total,
        documented,
        withUsage,
        withAuthor,
        documentationRate: total ? Math.round(documented / total * 100) + '%' : '0%',
        undocumented,
      }
    };
  });

  // Single command detail
  router.get('/api/commands/:name', (req, params) => {
    const name = params.name;
    const fullPath = path.join(BIN_DIR, name);
    if (!fs.existsSync(fullPath)) {
      return { status: 404, body: { error: `Command '${name}' not found` } };
    }
    const info = parseScript(fullPath);

    // Also read the full header for detailed docs
    let header = '';
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      const headerLines = [];
      let inHeader = false;
      for (let i = 0; i < Math.min(lines.length, 40); i++) {
        const line = lines[i];
        if (i === 0 && line.startsWith('#!')) { inHeader = true; continue; }
        if (line.startsWith('#') || line.startsWith('//') || line.startsWith(' *') || line.startsWith('/*') || line.startsWith('"""') || line.trim() === '') {
          headerLines.push(line);
          inHeader = true;
        } else if (inHeader) {
          break;
        }
      }
      header = headerLines.join('\n').trim();
    } catch (e) { /* ignore */ }

    return {
      status: 200,
      body: { name, ...info, header }
    };
  });

}

module.exports = { register };
