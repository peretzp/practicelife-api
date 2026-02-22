// Spend Tracking — Unified token usage and cost analysis across all AI services
const Database = require('better-sqlite3');
const { readFileSync } = require('fs');
const { homedir } = require('os');
const path = require('path');

// Anthropic pricing per million tokens (as of Feb 2026)
const PRICING = {
  // Claude 4.6 family
  'claude-opus-4-6': { input: 15.00, output: 75.00, cache_write: 18.75, cache_read: 1.50 },

  // Claude 4.5 family
  'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00, cache_write: 3.75, cache_read: 0.30 },
  'claude-opus-4-5-20251101': { input: 15.00, output: 75.00, cache_write: 18.75, cache_read: 1.50 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00, cache_write: 1.00, cache_read: 0.08 },

  // Fallback for unknown models
  'default': { input: 3.00, output: 15.00, cache_write: 3.75, cache_read: 0.30 },
};

// Token estimation — rough approximation (1 token ≈ 4 chars for English)
const CHARS_PER_TOKEN = 4;

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function getModelPricing(model) {
  // Normalize model name
  if (model && PRICING[model]) return PRICING[model];

  // Fallback logic
  if (model && model.includes('opus')) return PRICING['claude-opus-4-6'];
  if (model && model.includes('sonnet')) return PRICING['claude-sonnet-4-5-20250929'];
  if (model && model.includes('haiku')) return PRICING['claude-haiku-4-5-20251001'];

  return PRICING['default'];
}

function calculateCost(tokens, pricePerMillion) {
  return (tokens / 1_000_000) * pricePerMillion;
}

/**
 * GET /api/spend — Unified spend tracking across all services
 */
async function getSpendOverview(req, params) {
  const db = new Database(path.join(homedir(), '.claude/prompts.db'), { readonly: true });

  try {
    // 1. Get all prompts with estimates
    const prompts = db.prepare(`
      SELECT
        session_id,
        model,
        LENGTH(content) as content_length,
        timestamp,
        agent
      FROM prompts
      WHERE model IS NOT NULL
      ORDER BY timestamp DESC
    `).all();

    // 2. Aggregate by model
    const byModel = {};
    let totalInputTokens = 0;
    let totalOutputTokens = 0; // We don't have response lengths, so this is approximate
    let totalCost = 0;

    prompts.forEach(prompt => {
      const model = prompt.model || 'unknown';
      const inputTokens = Math.ceil(prompt.content_length / CHARS_PER_TOKEN);

      // Estimate output tokens (assume 2:1 input:output ratio — conservative)
      const outputTokens = Math.floor(inputTokens * 0.5);

      if (!byModel[model]) {
        byModel[model] = {
          model,
          prompts: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
        };
      }

      const pricing = getModelPricing(model);
      const inputCost = calculateCost(inputTokens, pricing.input);
      const outputCost = calculateCost(outputTokens, pricing.output);

      byModel[model].prompts++;
      byModel[model].inputTokens += inputTokens;
      byModel[model].outputTokens += outputTokens;
      byModel[model].totalTokens += (inputTokens + outputTokens);
      byModel[model].estimatedCost += (inputCost + outputCost);

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      totalCost += (inputCost + outputCost);
    });

    // 3. Session summary
    const sessions = db.prepare(`
      SELECT
        COUNT(DISTINCT session_id) as total_sessions,
        MIN(timestamp) as earliest,
        MAX(timestamp) as latest
      FROM prompts
    `).get();

    // 4. Recent activity (last 7 days)
    const recentCost = db.prepare(`
      SELECT
        COUNT(*) as prompts,
        SUM(LENGTH(content)) as total_chars
      FROM prompts
      WHERE timestamp >= datetime('now', '-7 days')
    `).get();

    const recentTokens = estimateTokens(recentCost.total_chars);
    const recentOutputTokens = Math.floor(recentTokens * 0.5);
    const recentSpend = calculateCost(recentTokens, 3.00) + calculateCost(recentOutputTokens, 15.00);

    // 5. Build response
    return {
      status: 200,
      body: {
        summary: {
          totalPrompts: prompts.length,
          totalSessions: sessions.total_sessions,
          totalInputTokens,
          totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens,
          estimatedCost: parseFloat(totalCost.toFixed(2)),
          currency: 'USD',
          period: {
            start: sessions.earliest,
            end: sessions.latest,
          },
        },
        byModel: Object.values(byModel).sort((a, b) => b.estimatedCost - a.estimatedCost),
        recent7Days: {
          prompts: recentCost.prompts,
          tokens: recentTokens + recentOutputTokens,
          estimatedCost: parseFloat(recentSpend.toFixed(2)),
        },
        notes: [
          'Token counts are ESTIMATES based on character length (1 token ≈ 4 chars)',
          'Output tokens estimated at 50% of input (conservative 2:1 ratio)',
          'Actual costs may vary — this uses Anthropic list pricing',
          'Cache savings NOT included (not tracked in prompt store)',
          'For precise tracking, use Langfuse integration at /api/demo/llm-call',
        ],
      },
    };
  } finally {
    db.close();
  }
}

/**
 * GET /api/spend/cache-explainer — Explain how caching saves money
 */
async function getCacheExplainer(req, params) {
  return {
    status: 200,
    body: {
      title: 'How Claude Prompt Caching Saves Money',

      tldr: 'Caching lets you reuse expensive context (long system prompts, documents) across requests. Cache reads cost 10% of regular input tokens, cache writes cost 25% more than input.',

      pricing: {
        regular: {
          input: '$3.00 per million tokens (Sonnet 4.5)',
          output: '$15.00 per million tokens',
        },
        cache: {
          cache_write: '$3.75 per million tokens (25% premium to create cache)',
          cache_read: '$0.30 per million tokens (90% discount)',
        },
      },

      example: {
        scenario: 'You have a 50K token system prompt that you send with every request',
        without_caching: {
          cost_per_request: '$0.15 (50K tokens × $3.00 per million)',
          cost_100_requests: '$15.00',
        },
        with_caching: {
          first_request: '$0.1875 (50K tokens × $3.75 cache_write)',
          next_99_requests: '$0.015 each (50K tokens × $0.30 cache_read)',
          total: '$0.1875 + ($0.015 × 99) = $1.6725',
          savings: '$13.33 (89% cheaper)',
        },
      },

      how_it_works: {
        '1_cache_creation': 'First request with new context → Claude creates cache (cache_create tokens)',
        '2_cache_reuse': 'Subsequent requests with same context → Claude reuses cache (cache_read tokens)',
        '3_cache_lifetime': 'Caches last 5 minutes, then expire. Fresh request = new cache_create.',
        '4_cache_breakpoints': 'Use cache breakpoints to mark what to cache (system prompts, long docs)',
      },

      token_breakdown: {
        input_tokens: 'Fresh tokens sent to Claude (not from cache)',
        output_tokens: 'Tokens Claude generates in response',
        cache_create_tokens: 'Tokens written to cache (charged at cache_write rate)',
        cache_read_tokens: 'Tokens read from cache (charged at cache_read rate — 90% discount)',
        total_tokens: 'input + output + cache_create + cache_read',
      },

      real_world_use_cases: [
        'Long system prompts (MEMORY.md, CLAUDE.md) — cache these to save 90% on every request',
        'Document analysis — upload a PDF once, ask many questions (cache the PDF content)',
        'Codebase context — cache file contents, ask multiple questions about the code',
        'Conversation history — cache earlier turns to keep context without re-paying input costs',
      ],

      langfuse_tracking: {
        note: 'Langfuse tracks cache_create and cache_read separately',
        endpoint: '/api/demo/llm-call',
        usage_object: {
          input: 150,
          output: 75,
          cacheRead: 50000,
          cacheCreate: 0,
        },
      },

      bottom_line: 'If you send the same context repeatedly, caching pays for itself after 2-3 requests. Always cache system prompts, long documents, and stable context.',
    },
  };
}

/**
 * GET /api/spend/services — Token usage apportioned across services
 */
async function getServiceBreakdown(req, params) {
  return {
    status: 200,
    body: {
      services: [
        {
          name: 'Claude Code CLI',
          port: null,
          description: 'Terminal-based Claude interactions',
          tracking: 'Prompt store (prompts.db)',
          coverage: 'All Claude Code sessions',
          token_source: 'Estimated from prompt character length',
          models_used: ['claude-sonnet-4-5-20250929', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
          estimated_share: '95%',
          note: 'Primary AI spend — orchestration, coding, system management',
        },
        {
          name: 'Life Dashboard',
          port: 3000,
          url: 'https://localhost:3000',
          description: 'Personal data dashboard',
          tracking: 'None currently',
          coverage: 'No LLM calls yet',
          token_source: 'N/A',
          models_used: [],
          estimated_share: '0%',
          note: 'Pure data visualization — no AI inference',
        },
        {
          name: 'PracticeLife API',
          port: 3001,
          url: 'https://localhost:3001',
          description: 'Unified personal API',
          tracking: 'Langfuse (ready, not active)',
          coverage: 'Demo endpoint only',
          token_source: 'Langfuse tracking when live',
          models_used: [],
          estimated_share: '0%',
          note: 'Infrastructure ready for LLM endpoints — not yet implemented',
        },
        {
          name: 'Prompt Browser',
          port: 3002,
          url: 'https://localhost:3002',
          description: 'Prompt history viewer',
          tracking: 'Reads prompts.db',
          coverage: 'Displays data, no LLM calls',
          token_source: 'N/A',
          models_used: [],
          estimated_share: '0%',
          note: 'Read-only interface to prompt store',
        },
        {
          name: 'Cursor IDE',
          port: null,
          description: 'Visual code editor',
          tracking: 'Cursor cloud (external)',
          coverage: 'Tab completions + Cmd+K edits',
          token_source: 'Cursor\'s internal tracking (not visible)',
          models_used: ['gpt-4', 'claude-sonnet-4-5 (via Cursor proxy)'],
          estimated_share: '5%',
          note: '$20/mo flat fee, unlimited tab completions — best ROI',
        },
        {
          name: 'Codex CLI',
          port: null,
          description: 'OpenAI-based assistant',
          tracking: 'Codex session logs',
          coverage: 'Coordination, test scaffolding',
          token_source: 'ChatGPT subscription (unlimited)',
          models_used: ['gpt-5.3-codex'],
          estimated_share: '0%',
          note: 'Included in ChatGPT subscription — no marginal cost',
        },
      ],
      total_spend_sources: {
        anthropic: {
          services: ['Claude Code CLI'],
          pricing: 'Per-token (Sonnet/Opus/Haiku)',
          estimated_monthly: '$100-200',
        },
        cursor: {
          services: ['Cursor IDE'],
          pricing: 'Flat $20/mo (Pro plan)',
          estimated_monthly: '$20',
        },
        openai: {
          services: ['Codex CLI'],
          pricing: 'Included in ChatGPT subscription',
          estimated_monthly: '$0 marginal',
        },
      },
      notes: [
        'Claude Code CLI is 95%+ of Anthropic spend',
        'Cursor is flat $20/mo regardless of usage — highest value',
        'Local services (:3000, :3001, :3002) currently have ZERO AI spend',
        'Langfuse ready to track API spend when LLM endpoints go live',
      ],
    },
  };
}

module.exports = {
  register(router) {
    router.get('/api/spend', getSpendOverview);
    router.get('/api/spend/cache', getCacheExplainer);
    router.get('/api/spend/services', getServiceBreakdown);
  },
};
