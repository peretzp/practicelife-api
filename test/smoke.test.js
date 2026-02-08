const test = require('node:test');
const assert = require('node:assert/strict');

const { Router } = require('../lib/router');
const atlas = require('../routes/atlas');
const vault = require('../routes/vault');
const system = require('../routes/system');
const agents = require('../routes/agents');

function buildRouter() {
  const router = new Router();
  atlas.register(router);
  vault.register(router);
  system.register(router);
  agents.register(router);
  return router;
}

function invoke(router, url) {
  const match = router.match('GET', url);
  assert.ok(match, `Expected route to match: ${url}`);
  return match.handler({ method: 'GET', url }, match.params);
}

test('atlas assets endpoint returns data or service-unavailable', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/atlas/assets?limit=5&offset=0&type=voice_memo');

  assert.ok([200, 503].includes(result.status));
  if (result.status === 200) {
    assert.ok(Array.isArray(result.body.assets));
    assert.equal(result.body.limit, 5);
    assert.equal(result.body.offset, 0);
    assert.equal(typeof result.body.total, 'number');
  }
});

test('atlas single asset endpoint returns 404 for missing id or 503', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/atlas/assets/__missing_asset_id__');
  assert.ok([404, 503].includes(result.status));
});

test('atlas stats endpoint returns stats object or 503', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/atlas/stats');

  assert.ok([200, 503].includes(result.status));
  if (result.status === 200) {
    assert.equal(typeof result.body.total_assets, 'number');
    assert.ok(Array.isArray(result.body.byType));
  }
});

test('atlas search endpoint returns result list or 503', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/atlas/search/meeting');

  assert.ok([200, 503].includes(result.status));
  if (result.status === 200) {
    assert.ok(Array.isArray(result.body.results));
    assert.equal(typeof result.body.count, 'number');
    assert.equal(result.body.query, 'meeting');
  }
});

test('vault notes endpoint blocks path traversal', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/vault/notes?dir=../private');

  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Invalid directory');
});

test('vault note endpoint blocks path traversal', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/vault/note?path=..%2Fsecrets.md');

  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Invalid path');
});

test('vault stats endpoint returns note count', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/vault/stats');

  assert.equal(result.status, 200);
  assert.equal(typeof result.body.totalNotes, 'number');
  assert.equal(typeof result.body.vaultPath, 'string');
});

test('vault list endpoint returns notes array for safe dir', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/vault/notes?dir=');

  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.body.notes));
});

test('vault note endpoint returns 404 for missing note', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/vault/note?path=__does_not_exist__.md');

  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'Note not found');
});

test('vault structure endpoint returns top-level structure', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/vault/structure');

  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.body.structure));
});

test('system state endpoint returns machine metrics', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/system/state');

  assert.equal(result.status, 200);
  assert.equal(typeof result.body.hostname, 'string');
  assert.equal(typeof result.body.cpus, 'number');
  assert.equal(typeof result.body.totalMemoryGB, 'number');
  assert.equal(typeof result.body.loadAvg, 'object');
});

test('system volumes endpoint returns array', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/system/volumes');

  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.body.volumes));
});

test('system ollama endpoint returns availability flag and models', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/system/ollama');

  assert.equal(result.status, 200);
  assert.equal(typeof result.body.available, 'boolean');
  assert.ok(Array.isArray(result.body.models));
});

test('agents protocol endpoint returns content or missing-file error', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/agents/protocol');

  assert.ok([200, 404].includes(result.status));
  if (result.status === 200) {
    assert.equal(typeof result.body.path, 'string');
    assert.equal(typeof result.body.content, 'string');
  }
});

test('agents sessions endpoint returns list', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/agents/sessions');

  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.body.sessions));
});

test('agents session endpoint blocks traversal', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/agents/sessions/..%2Fprivate.md');

  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Invalid path');
});

test('agents collab brief endpoint returns content or missing-file error', () => {
  const router = buildRouter();
  const result = invoke(router, '/api/agents/collab-brief');

  assert.ok([200, 404].includes(result.status));
  if (result.status === 200) {
    assert.equal(typeof result.body.content, 'string');
  }
});

/*
---
Timestamp: 2026-02-08T15:18:54-0800
Location: N/A
Signed By: Peretz Partensky
AI: Codex (GPT-5)
Chat/Project: Multi-agent API wiring
Conversation Link: Codex desktop thread (local)
Artifact Path: /Users/peretz_1/api/test/smoke.test.js
---
*/
