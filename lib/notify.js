// Outbound edges — env-gated, safe no-ops when unconfigured.
// Never throws, never sends when the relevant env var is unset.
// Zero external deps; uses node's built-in https.

const https = require('https');

// POST JSON to an absolute https URL. Resolves the parsed body, or an object
// carrying { error } / { ok, status } on non-JSON responses. Never rejects.
function postJson(urlString, payload, headers = {}) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(urlString);
    } catch (err) {
      resolve({ error: `invalid url: ${err.message}` });
      return;
    }
    const data = JSON.stringify(payload);
    const options = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || 443,
      path: (url.pathname || '/') + (url.search || ''),
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }, headers),
      timeout: 5000,
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: body.slice(0, 500) });
        }
      });
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.write(data);
    req.end();
  });
}

// Post a message to Slack. No-op (logged) when SLACK_BOT_TOKEN is unset.
async function postSlackMessage(channel, text) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.log('[notify] postSlackMessage skipped (no SLACK_BOT_TOKEN) —', JSON.stringify({ channel, text }));
    return { skipped: true, reason: 'no SLACK_BOT_TOKEN' };
  }
  try {
    return await postJson('https://slack.com/api/chat.postMessage', { channel, text }, { Authorization: `Bearer ${token}` });
  } catch (err) {
    return { error: err.message };
  }
}

// Forward an event to the Oakland fleet endpoint. No-op (logged) when unset.
async function forwardToOakland(event) {
  const url = process.env.OAKLAND_FLEET_URL;
  if (!url) {
    console.log('[notify] forwardToOakland skipped (no OAKLAND_FLEET_URL) —', JSON.stringify(event));
    return { skipped: true };
  }
  try {
    return await postJson(url, event);
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { postSlackMessage, forwardToOakland };
