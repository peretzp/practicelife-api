const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Isolate SQLite databases in a temp HOME before requiring modules that open
// them (both coorddb and taskdb resolve their paths from os.homedir() at
// require time). Restore HOME afterward so suites co-loaded via test/index.js
// still see the real home — the DB paths are already captured by then.
const ORIGINAL_HOME = process.env.HOME;
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'plife-coord-'));
fs.mkdirSync(path.join(TMP_HOME, '.claude'), { recursive: true });
process.env.HOME = TMP_HOME;

const { requireSecret, verifySlackSignature } = require('../lib/coord-auth');
const coorddb = require('../lib/coorddb');
const { Router } = require('../lib/router');
const slack = require('../routes/slack');
const { isAnvilConnectivityAlert } = slack;

if (ORIGINAL_HOME === undefined) delete process.env.HOME;
else process.env.HOME = ORIGINAL_HOME;

const SIGNING_SECRET = 'test-signing-secret';

function slackSig(rawBody, ts, secret = SIGNING_SECRET) {
  return 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex');
}

// --- requireSecret ---

test('requireSecret returns false when COORD_SHARED_SECRET is unset', () => {
  delete process.env.COORD_SHARED_SECRET;
  assert.equal(requireSecret({ headers: { 'x-coord-secret': 'anything' } }), false);
});

test('requireSecret matches the shared secret in constant time', () => {
  process.env.COORD_SHARED_SECRET = 'super-secret-123';
  assert.equal(requireSecret({ headers: { 'x-coord-secret': 'super-secret-123' } }), true);
  assert.equal(requireSecret({ headers: { 'x-coord-secret': 'wrong' } }), false);
  assert.equal(requireSecret({ headers: {} }), false);
  assert.equal(requireSecret({}), false);
  delete process.env.COORD_SHARED_SECRET;
});

// --- verifySlackSignature ---

test('verifySlackSignature accepts a known-good signature', () => {
  process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  const rawBody = JSON.stringify({ type: 'url_verification', challenge: 'abc' });
  const ts = Math.floor(Date.now() / 1000).toString();
  const headers = { 'x-slack-request-timestamp': ts, 'x-slack-signature': slackSig(rawBody, ts) };
  assert.equal(verifySlackSignature(rawBody, headers), true);
  delete process.env.SLACK_SIGNING_SECRET;
});

test('verifySlackSignature rejects tampered body and stale timestamps', () => {
  process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  const rawBody = JSON.stringify({ foo: 'bar' });
  const ts = Math.floor(Date.now() / 1000).toString();
  const goodHeaders = { 'x-slack-request-timestamp': ts, 'x-slack-signature': slackSig(rawBody, ts) };

  // Tampered body no longer matches the signature.
  assert.equal(verifySlackSignature(rawBody + 'tamper', goodHeaders), false);

  // Stale timestamp (>300s) is rejected even with a valid signature.
  const staleTs = (Math.floor(Date.now() / 1000) - 400).toString();
  const staleHeaders = { 'x-slack-request-timestamp': staleTs, 'x-slack-signature': slackSig(rawBody, staleTs) };
  assert.equal(verifySlackSignature(rawBody, staleHeaders), false);

  // Missing headers.
  assert.equal(verifySlackSignature(rawBody, {}), false);
  delete process.env.SLACK_SIGNING_SECRET;
});

test('verifySlackSignature returns false when SLACK_SIGNING_SECRET is unset', () => {
  delete process.env.SLACK_SIGNING_SECRET;
  const headers = { 'x-slack-request-timestamp': '1', 'x-slack-signature': 'v0=deadbeef' };
  assert.equal(verifySlackSignature('body', headers), false);
});

// --- coorddb ---

test('coorddb seeds the practicelife agent on first open', () => {
  const agents = coorddb.listAgents();
  assert.ok(agents.find(a => a.name === 'practicelife'), 'expected seeded practicelife agent');
});

test('coorddb appendEvent + listEvents round-trips and filters', () => {
  const ev = coorddb.appendEvent({
    source: 'slack', actor: 'U1', kind: 'alert', ref: 'C1/1.2', summary: 'test event', payload: { a: 1 },
  });
  assert.equal(typeof ev.id, 'number');
  assert.equal(ev.source, 'slack');
  assert.equal(ev.summary, 'test event');
  assert.deepEqual(ev.payload, { a: 1 });

  const events = coorddb.listEvents({ limit: 10 });
  assert.ok(events.length >= 1);
  assert.equal(events[0].id, ev.id, 'most recent event first');

  coorddb.appendEvent({ source: 'coord', kind: 'task', summary: 'other' });
  const onlySlackAlerts = coorddb.listEvents({ source: 'slack', kind: 'alert' });
  assert.ok(onlySlackAlerts.length >= 1);
  assert.ok(onlySlackAlerts.every(e => e.source === 'slack' && e.kind === 'alert'));
});

test('coorddb upsertAgent inserts, updates, and preserves fields; getState aggregates', () => {
  const agent = coorddb.upsertAgent({
    name: 'galen-care', kind: 'repo', machine: 'anvil', repo: 'galen-care',
    endpoint: 'https://x', meta: { role: 'care' },
  });
  assert.equal(agent.name, 'galen-care');
  assert.equal(agent.kind, 'repo');
  assert.deepEqual(agent.meta, { role: 'care' });

  // Partial upsert updates endpoint but preserves kind (COALESCE).
  const updated = coorddb.upsertAgent({ name: 'galen-care', endpoint: 'https://y' });
  assert.equal(updated.endpoint, 'https://y');
  assert.equal(updated.kind, 'repo');

  const state = coorddb.getState();
  assert.ok(Array.isArray(state.agents));
  assert.ok(Array.isArray(state.recentEvents));
  assert.ok(state.agents.find(a => a.name === 'galen-care'));
});

// --- isAnvilConnectivityAlert ---

test('isAnvilConnectivityAlert matches connectivity complaints', () => {
  assert.ok(isAnvilConnectivityAlert('Anvil is down'));
  assert.ok(isAnvilConnectivityAlert("can't reach anvil"));
  assert.ok(isAnvilConnectivityAlert('anvil timed out'));
  assert.ok(isAnvilConnectivityAlert('Anvil is unreachable'));
  assert.ok(isAnvilConnectivityAlert('lost connection to anvil'));
  assert.ok(isAnvilConnectivityAlert('anvil offline'));
});

test('isAnvilConnectivityAlert ignores non-alerts', () => {
  assert.equal(isAnvilConnectivityAlert('anvil is running great'), false);
  assert.equal(isAnvilConnectivityAlert('the weather is nice today'), false);
  assert.equal(isAnvilConnectivityAlert('hearth deploy finished'), false);
  assert.equal(isAnvilConnectivityAlert(''), false);
  assert.equal(isAnvilConnectivityAlert(undefined), false);
});

// --- slack route ---

test('slack health endpoint reports config flag without auth', () => {
  const router = new Router();
  slack.register(router);
  const match = router.match('GET', '/api/slack/health');
  const result = match.handler({ method: 'GET', url: '/api/slack/health' }, match.params);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(typeof result.body.slackConfigured, 'boolean');
});

test('slack events url_verification handshake returns the challenge', async () => {
  process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  const router = new Router();
  slack.register(router);
  const match = router.match('POST', '/api/slack/events');

  const rawBody = JSON.stringify({ type: 'url_verification', challenge: 'the-challenge-token' });
  const ts = Math.floor(Date.now() / 1000).toString();
  const req = {
    method: 'POST',
    url: '/api/slack/events',
    rawBody,
    body: JSON.parse(rawBody),
    headers: { 'x-slack-request-timestamp': ts, 'x-slack-signature': slackSig(rawBody, ts) },
  };
  const result = await match.handler(req, match.params);
  assert.equal(result.status, 200);
  assert.equal(result.body.challenge, 'the-challenge-token');

  // Bad signature is rejected.
  const badReq = { ...req, headers: { 'x-slack-request-timestamp': ts, 'x-slack-signature': 'v0=deadbeef' } };
  const badResult = await match.handler(badReq, match.params);
  assert.equal(badResult.status, 401);
  assert.equal(badResult.body.error, 'bad signature');
  delete process.env.SLACK_SIGNING_SECRET;
});
