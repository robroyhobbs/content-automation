#!/usr/bin/env node

/**
 * Content Automation Hub - Main Orchestrator
 *
 * Runs scheduled tasks based on configuration.
 * Can be triggered by launchd or run manually.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import logger from './shared/logger.mjs';
import state from './shared/state.mjs';
import taskLoader from './shared/task-loader.mjs';
import { recordOutcome } from './shared/learning.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(__dirname, '..', 'config', 'settings.yaml');

/**
 * Load global settings
 */
function loadSettings() {
  try {
    return parseYaml(readFileSync(CONFIG_FILE, 'utf8'));
  } catch (error) {
    logger.error('Failed to load settings', { error: error.message });
    return {};
  }
}

/**
 * Run a single task
 */
async function runTask(taskName, taskConfig, hubState) {
  logger.info(`Starting task: ${taskName}`, { category: taskConfig.category });

  // Check if task can run
  const { canRun, reason } = state.canTaskRun(hubState, taskName, taskConfig);
  if (!canRun) {
    logger.info(`Skipping ${taskName}: ${reason}`);
    return { skipped: true, reason };
  }

  // Mark task as started
  state.startTask(hubState, taskName);

  try {
    // Load and run the task
    const runner = await taskLoader.loadTaskRunner(taskName);

    if (typeof runner.run !== 'function') {
      throw new Error('Task runner must export a run() function');
    }

    // Create task context
    const context = {
      taskName,
      config: taskConfig,
      logger: (await import('./shared/logger.mjs')).createTaskLogger(taskName),
      state: state.getTaskState(hubState, taskName)
    };

    // Execute the task
    const startTime = Date.now();
    const result = await runner.run(context);
    const duration = Date.now() - startTime;

    // Mark complete
    state.completeTask(hubState, taskName, result.success, {
      output: result.output,
      url: result.url,
      duration
    });

    // Record outcome for learning
    recordOutcome({
      task: taskName,
      success: result.success,
      duration,
      output: result.output,
      url: result.url,
      context: {
        category: taskConfig.category,
        contentType: result.contentType
      }
    });

    logger.info(`Task completed: ${taskName}`, { success: result.success });

    return result;

  } catch (error) {
    logger.error(`Task failed: ${taskName}`, { error: error.message });

    state.completeTask(hubState, taskName, false, {
      error: error.message
    });

    // Record failure for learning
    recordOutcome({
      task: taskName,
      success: false,
      error: error.message,
      context: {
        category: taskConfig.category
      }
    });

    return { success: false, error: error.message };
  }
}

/**
 * Main orchestrator - runs all scheduled tasks
 */
async function main() {
  logger.info('═'.repeat(60));
  logger.info('Content Automation Hub Starting');
  logger.info('═'.repeat(60));

  const settings = loadSettings();
  const hubState = state.loadState();

  // Get enabled tasks
  const enabledTasks = taskLoader.getEnabledTasks();

  if (enabledTasks.length === 0) {
    logger.warn('No enabled tasks found');
    return;
  }

  logger.info(`Found ${enabledTasks.length} enabled tasks`);

  // Run each enabled task
  const results = {
    ran: 0,
    skipped: 0,
    success: 0,
    failed: 0
  };

  for (const task of enabledTasks) {
    const result = await runTask(task.name, task.config, hubState);

    if (result.skipped) {
      results.skipped++;
    } else {
      results.ran++;
      if (result.success) {
        results.success++;
      } else {
        results.failed++;
      }
    }

    // Circuit breaker: stop if too many consecutive failures
    if (results.failed >= 3) {
      logger.error('Circuit breaker: too many failures, stopping');
      break;
    }
  }

  // Save final state
  state.saveState(hubState);

  logger.info('═'.repeat(60));
  logger.info('Content Automation Hub Complete', results);
  logger.info('═'.repeat(60));
}

// Run
main().catch(error => {
  logger.error('Hub crashed', { error: error.message, stack: error.stack });
  process.exit(1);
});
