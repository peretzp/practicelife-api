// Obsidian vault filesystem helpers
const fs = require('fs');
const path = require('path');

const VAULT_PATH = path.join(
  process.env.HOME,
  'Library/Mobile Documents/iCloud~md~obsidian/Documents/PracticeLife'
);

function listNotes(subdir = '') {
  const dir = path.join(VAULT_PATH, subdir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: false })
    .filter(f => f.endsWith('.md'))
    .map(f => ({
      name: f.replace(/\.md$/, ''),
      path: path.join(subdir, f),
      modified: fs.statSync(path.join(dir, f)).mtime.toISOString(),
    }));
}

function readNote(relativePath) {
  const fullPath = path.join(VAULT_PATH, relativePath);
  // Prevent path traversal
  if (!fullPath.startsWith(VAULT_PATH)) return null;
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf8');
}

function vaultStats() {
  let count = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) count++;
    }
  }
  walk(VAULT_PATH);
  return { totalNotes: count, vaultPath: VAULT_PATH };
}

module.exports = { listNotes, readNote, vaultStats, VAULT_PATH };
