// /api/slack/* — Slack Events API ingress (signature-verified)
// Vertical slice: an "Anvil is down" message in Slack opens a priority task,
// records a coordination event, forwards to Oakland, and acks in-channel.

const taskdb = require('../lib/taskdb');
const coorddb = require('../lib/coorddb');
const { verifySlackSignature } = require('../lib/coord-auth');
const { probeAnvil } = require('./fleet');
const { postSlackMessage, forwardToOakland } = require('../lib/notify');

// Heuristic: does this message report Anvil being unreachable / down?
// Requires the whole word "anvil" AND a whole-word/phrase connectivity signal,
// so incidental substrings (download, online, another, notify, know) never fire.
// Multi-word negatives ("not reachable", "not responding", ...) are matched as
// phrases so we keep recall without reintroducing bare-substring false matches.
function isAnvilConnectivityAlert(text) {
  if (!text) return false;
  return /\banvil\b/i.test(text) &&
    /\b(can'?t|cannot|couldn'?t|unable|unreachable|offline|down|dropping|disconnect\w*|lost|timed?\s*out|timeout|refus\w*|fail\w*|no\s+connection|not\s+(?:reachable|responding|response|available|connect\w*|work\w*|up|online|responsive))\b/i.test(text);
}

// Side effects for an Anvil alert. Runs AFTER the 200 is sent so we never blow
// Slack's ~3s ack window. The durable step (task + coord event) is fully
// SYNCHRONOUS and the claim is completed immediately after it with NO await in
// between — so a crash during the later (awaited) enrichment can never leave the
// claim 'processing', which a stale reclaim would otherwise duplicate. If the
// durable step throws, the claim is released so a Slack retry reprocesses.
// Enrichment failures are swallowed and never touch the claim.
async function handleAnvilAlert(event, body, key) {
  const peretzId = process.env.PERETZ_SLACK_ID || 'U0B090UP4DV';
  const channel = event.channel;
  const slackUser = event.user;

  let task;
  // (1) Durable step — synchronous; completeEvent runs with no await before it.
  try {
    task = taskdb.createTask({
      title: 'Fix Anvil connectivity',
      description:
        `Reporter: <@${slackUser}>\n` +
        `Channel: ${channel}\n` +
        `Original message: ${event.text}`,
      assignee: peretzId,
      priority: 1,
      source: 'slack',
    });
    taskdb.addWatcher(task.id, peretzId);
    coorddb.appendEvent({
      source: 'slack',
      actor: slackUser,
      kind: 'alert',
      ref: `${channel}/${event.ts}`,
      summary: 'Anvil connectivity alert',
      payload: { text: event.text, taskId: task.id },
    });
    coorddb.completeEvent(key);
  } catch (e) {
    console.error('[slack] anvil alert durable step failed:', e);
    coorddb.releaseEvent(key); // durable step failed → allow a Slack retry to reprocess
    return;
  }

  // (2) Best-effort enrichment — the alert is already persisted and the claim is
  // completed, so failures here must NOT touch the claim.
  try {
    const probe = await probeAnvil();
    taskdb.addMessage(task.id, {
      author: 'slack-bot',
      type: 'note',
      content:
        `Anvil probe: ${probe.ok ? `reachable (${probe.latencyMs}ms)` : 'UNREACHABLE'}\n` +
        JSON.stringify(probe, null, 2),
    });
    await forwardToOakland({
      source: 'slack',
      kind: 'alert',
      summary: 'Anvil connectivity alert',
      ref: `${channel}/${event.ts}`,
      reporter: slackUser,
      text: event.text,
      probe,
      taskId: task.id,
    });
    await postSlackMessage(
      channel,
      `👀 I see the alert — opened a priority task for <@${peretzId}>. Anvil probe: ` +
      (probe.ok ? `reachable (${probe.latencyMs}ms)` : 'UNREACHABLE') + '.'
    );
  } catch (e) {
    console.error('[slack] anvil alert enrichment failed:', e);
  }
}

function register(router) {
  // GET /api/slack/health — unauthenticated liveness + config flag
  router.get('/api/slack/health', () => {
    return { status: 200, body: { ok: true, slackConfigured: !!process.env.SLACK_SIGNING_SECRET } };
  });

  // POST /api/slack/events — Slack Events API webhook
  router.post('/api/slack/events', (req) => {
    if (!verifySlackSignature(req.rawBody, req.headers || {})) {
      return { status: 401, body: { error: 'bad signature' } };
    }

    const body = req.body || {};

    // URL verification handshake (Slack app setup) — synchronous.
    if (body.type === 'url_verification') {
      return { status: 200, body: { challenge: body.challenge } };
    }

    if (body.type === 'event_callback') {
      const event = body.event || {};
      const isUserMessage = event.type === 'message' && !event.subtype && !event.bot_id;

      if (isUserMessage && isAnvilConnectivityAlert(event.text)) {
        // Idempotency: claim the event key (Slack's event_id is stable across
        // retries; fall back to channel:ts) BEFORE any work. A claim held by a
        // crashed run goes stale and can be reclaimed by a later retry.
        const key = body.event_id || `${event.channel}:${event.ts}`;
        const claim = coorddb.claimEvent(key);
        if (!claim.claimed) {
          return { status: 200, body: { ok: true, duplicate: true } };
        }

        // Ack immediately; run side effects fire-and-forget. complete/release
        // of the claim now happen INSIDE handleAnvilAlert, driven solely by the
        // durable step — so this dispatch only needs a crash guard.
        handleAnvilAlert(event, body, key).catch(err =>
          console.error('[slack] anvil alert handler crashed:', err)
        );

        return { status: 200, body: { ok: true } };
      }

      // Non-matching event — ack fast so Slack doesn't retry.
      return { status: 200, body: { ok: true, ignored: true } };
    }

    return { status: 200, body: { ok: true, ignored: true } };
  });
}

module.exports = { register, isAnvilConnectivityAlert, handleAnvilAlert };
