/**
 * Task Runner Template
 *
 * Copy this file to tasks/<your-task>/runner.mjs
 *
 * Your task MUST export a default object with a run() function.
 * The run() function receives a context object and must return a result.
 */

/**
 * Main task execution
 *
 * @param {Object} context - Task context
 * @param {string} context.taskName - Name of this task
 * @param {Object} context.config - Merged config (task.yaml + tasks.yaml)
 * @param {Object} context.logger - Task-specific logger
 * @param {Object} context.state - Task's current state
 *
 * @returns {Promise<Object>} Result object with { success, output?, url?, error? }
 */
async function run(context) {
  const { taskName, config, logger, state } = context;

  logger.info('Starting task execution');

  try {
    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Preparation
    // ═══════════════════════════════════════════════════════════════
    logger.info('Step 1: Preparing...');

    // Access task-specific settings
    const { settings } = config;
    // const apiKey = await loadCredential('openai');

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Main Logic
    // ═══════════════════════════════════════════════════════════════
    logger.info('Step 2: Executing main logic...');

    // TODO: Implement your task logic here
    // Examples:
    // - Generate content with Claude
    // - Post to social media
    // - Fetch and analyze data
    // - Send newsletter

    const result = {
      // Your task output
      itemsProcessed: 0,
      output: 'Task completed successfully'
    };

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Quality Check (optional)
    // ═══════════════════════════════════════════════════════════════
    logger.info('Step 3: Quality check...');

    // Validate output meets quality standards
    const qualityPassed = true;

    if (!qualityPassed) {
      return {
        success: false,
        error: 'Quality check failed'
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 4: Publish/Output
    // ═══════════════════════════════════════════════════════════════
    logger.info('Step 4: Publishing...');

    // Publish, save, or output results
    const publishedUrl = null; // Set if applicable

    // ═══════════════════════════════════════════════════════════════
    // Return Result
    // ═══════════════════════════════════════════════════════════════
    logger.info('Task completed successfully');

    return {
      success: true,
      output: result.output,
      url: publishedUrl,
      metadata: {
        itemsProcessed: result.itemsProcessed
      }
    };

  } catch (error) {
    logger.error('Task failed', { error: error.message });

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Optional: Get task status (for dashboard)
 */
async function getStatus(context) {
  return {
    healthy: true,
    pending: 0,
    queued: 0
  };
}

/**
 * Optional: Cleanup function (called on shutdown)
 */
async function cleanup(context) {
  // Clean up resources if needed
}

// Export the task runner
export default {
  run,
  getStatus,
  cleanup
};
