// Langfuse instrumentation wrapper for LLM calls
const { Langfuse } = require('langfuse');

// Initialize Langfuse client (lazy load)
let langfuseClient = null;

function getLangfuse() {
  if (!langfuseClient) {
    langfuseClient = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY || 'demo-public-key',
      secretKey: process.env.LANGFUSE_SECRET_KEY || 'demo-secret-key',
      baseUrl: process.env.LANGFUSE_BASE_URL || 'http://localhost:3005',
    });
  }
  return langfuseClient;
}

/**
 * Track an LLM call with Langfuse
 * @param {Object} params
 * @param {string} params.name - Name of the operation (e.g., "analyze-code", "generate-response")
 * @param {string} params.model - Model name (e.g., "claude-sonnet-4-5-20250929")
 * @param {string} params.input - Prompt/input text
 * @param {string} params.output - Response text
 * @param {Object} params.usage - Token usage { input, output, total, cacheRead?, cacheCreate? }
 * @param {Object} params.metadata - Additional metadata
 * @param {string} params.userId - User ID (default: 'peretz')
 * @param {string} params.sessionId - Session ID (optional)
 * @returns {Promise<void>}
 */
async function trackLLMCall(params) {
  const {
    name,
    model,
    input,
    output,
    usage,
    metadata = {},
    userId = 'peretz',
    sessionId,
  } = params;

  try {
    const langfuse = getLangfuse();

    const trace = langfuse.trace({
      name: name,
      userId: userId,
      sessionId: sessionId,
      metadata: {
        ...metadata,
        source: 'api-service',
        timestamp: new Date().toISOString(),
      },
    });

    const generation = trace.generation({
      name: name,
      model: model,
      modelParameters: metadata.modelParameters || {},
      input: input,
      output: output,
      usage: {
        input: usage.input || 0,
        output: usage.output || 0,
        total: usage.total || usage.input + usage.output,
      },
      metadata: {
        cacheRead: usage.cacheRead || 0,
        cacheCreate: usage.cacheCreate || 0,
      },
    });

    generation.end();

    // Flush to ensure data is sent immediately
    await langfuse.flushAsync();

    return { traceId: trace.id, success: true };
  } catch (error) {
    console.error('Langfuse tracking error:', error.message);
    // Don't throw - tracking failures shouldn't break the app
    return { success: false, error: error.message };
  }
}

/**
 * Wrapper for async LLM function - automatically tracks call
 * @param {Function} fn - Async function that makes LLM call
 * @param {Object} options - Tracking options (name, model, userId, sessionId, metadata)
 * @returns {Function} Wrapped function
 */
function withLangfuseTracking(fn, options = {}) {
  return async function(...args) {
    const startTime = Date.now();

    try {
      const result = await fn(...args);

      // Track the call
      await trackLLMCall({
        name: options.name || fn.name || 'llm-call',
        model: options.model || result.model || 'unknown',
        input: options.input || args[0] || '',
        output: options.output || result.output || result.content || '',
        usage: result.usage || { input: 0, output: 0, total: 0 },
        metadata: {
          ...options.metadata,
          duration_ms: Date.now() - startTime,
        },
        userId: options.userId || 'peretz',
        sessionId: options.sessionId,
      });

      return result;
    } catch (error) {
      // Track failed calls too
      await trackLLMCall({
        name: options.name || fn.name || 'llm-call',
        model: options.model || 'unknown',
        input: options.input || args[0] || '',
        output: `Error: ${error.message}`,
        usage: { input: 0, output: 0, total: 0 },
        metadata: {
          ...options.metadata,
          error: true,
          errorMessage: error.message,
          duration_ms: Date.now() - startTime,
        },
        userId: options.userId || 'peretz',
        sessionId: options.sessionId,
      });

      throw error;
    }
  };
}

module.exports = {
  trackLLMCall,
  withLangfuseTracking,
  getLangfuse,
};
