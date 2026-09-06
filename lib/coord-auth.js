// Coordination auth — shared-secret gate + Slack request signature verification
// Zero external deps; uses node's built-in crypto for constant-time comparison.

const crypto = require('crypto');

// Constant-time equality that is safe against length mismatches.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Gate writes: true iff header `x-coord-secret` matches COORD_SHARED_SECRET.
// Returns false if the env var is unset or the header is missing/mismatched.
function requireSecret(req) {
  const secret = process.env.COORD_SHARED_SECRET;
  if (!secret) return false;
  const provided = req && req.headers && req.headers['x-coord-secret'];
  if (typeof provided !== 'string' || provided.length === 0) return false;
  return safeEqual(provided, secret);
}

// Verify Slack's v0 request signature.
// See https://api.slack.com/authentication/verifying-requests-from-slack
function verifySlackSignature(rawBody, headers) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return false;
  if (!headers) return false;

  const timestamp = headers['x-slack-request-timestamp'];
  const signature = headers['x-slack-signature'];
  if (!timestamp || !signature) return false;

  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;

  // Reject requests older than 5 minutes (replay protection).
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) return false;

  const base = `v0:${timestamp}:${rawBody || ''}`;
  const expected = 'v0=' + crypto.createHmac('sha256', signingSecret).update(base).digest('hex');
  return safeEqual(expected, signature);
}

module.exports = { requireSecret, verifySlackSignature };
