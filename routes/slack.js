// /api/slack/* — Slack Events API ingress (signature-verified)
// Vertical slice: an "Anvil is down" message in Slack opens a priority task,
// records a coordination event, forwards to Oakland, and acks in-channel.

const taskdb = require('../lib/taskdb');
const coorddb = require('../lib/coorddb');
const { verifySlackSignature } = require('../lib/coord-auth');
const { probeAnvil } = require('./fleet');
const { postSlackMessage, forwardToOakland } = require('../lib/notify');

// Heuristic: does this message report Anvil being unreachable / down?
function isAnvilConnectivityAlert(text) {
  if (!text) return false;
  return /anvil/i.test(text) &&
    /(can'?t|cannot|not|un(able|reachable)|down|offline|no|lost|tim(e|ed)?\s*out|refus)/i.test(text);
}

function register(router) {
  // GET /api/slack/health — unauthenticated liveness + config flag
  router.get('/api/slack/health', () => {
    return { status: 200, body: { ok: true, slackConfigured: !!process.env.SLACK_SIGNING_SECRET } };
  });

  // POST /api/slack/events — Slack Events API webhook
  router.post('/api/slack/events', async (req) => {
    if (!verifySlackSignature(req.rawBody, req.headers || {})) {
      return { status: 401, body: { error: 'bad signature' } };
    }

    const body = req.body || {};

    // URL verification handshake (Slack app setup).
    if (body.type === 'url_verification') {
      return { status: 200, body: { challenge: body.challenge } };
    }

    if (body.type === 'event_callback') {
      const event = body.event || {};
      const isUserMessage = event.type === 'message' && !event.subtype && !event.bot_id;

      if (isUserMessage && isAnvilConnectivityAlert(event.text)) {
        const peretzId = process.env.PERETZ_SLACK_ID || 'U0B090UP4DV';
        const channel = event.channel;
        const slackUser = event.user;

        const probe = await probeAnvil();

        const task = taskdb.createTask({
          title: 'Fix Anvil connectivity',
          description:
            `Reporter: <@${slackUser}>\n` +
            `Channel: ${channel}\n` +
            `Original message: ${event.text}\n\n` +
            `Anvil probe:\n${JSON.stringify(probe, null, 2)}`,
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
          payload: { text: event.text, probe, taskId: task.id },
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

        return { status: 200, body: { ok: true } };
      }

      // Non-matching event — ack fast so Slack doesn't retry.
      return { status: 200, body: { ok: true, ignored: true } };
    }

    return { status: 200, body: { ok: true, ignored: true } };
  });
}

module.exports = { register, isAnvilConnectivityAlert };
