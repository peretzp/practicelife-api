// /api/vault/* — Obsidian vault query endpoints
const { listNotes, readNote, vaultStats } = require('../lib/vault');

function register(router) {
  // Vault overview stats
  router.get('/api/vault/stats', (req, params) => {
    return { status: 200, body: vaultStats() };
  });

  // List notes in a folder (e.g., /api/vault/notes?dir=Efforts/Active)
  router.get('/api/vault/notes', (req, params) => {
    const url = new URL(req.url, 'http://localhost');
    const dir = url.searchParams.get('dir') || '';
    // Prevent traversal
    if (dir.includes('..')) return { status: 400, body: { error: 'Invalid directory' } };
    return { status: 200, body: { notes: listNotes(dir), directory: dir } };
  });

  // Read a specific note (e.g., /api/vault/note?path=Dashboards/Home.md)
  router.get('/api/vault/note', (req, params) => {
    const url = new URL(req.url, 'http://localhost');
    const notePath = url.searchParams.get('path') || '';
    if (notePath.includes('..')) return { status: 400, body: { error: 'Invalid path' } };
    const content = readNote(notePath);
    if (content === null) return { status: 404, body: { error: 'Note not found' } };
    return { status: 200, body: { path: notePath, content } };
  });

  // List vault top-level structure
  router.get('/api/vault/structure', (req, params) => {
    const fs = require('fs');
    const path = require('path');
    const { VAULT_PATH } = require('../lib/vault');
    const entries = fs.readdirSync(VAULT_PATH, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }));
    return { status: 200, body: { structure: entries } };
  });
}

module.exports = { register };
