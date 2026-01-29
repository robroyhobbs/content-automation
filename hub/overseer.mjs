#!/usr/bin/env node

/**
 * Content Automation Hub - Overseer Agent
 *
 * Monitors task health, detects issues, and takes corrective actions.
 * Runs continuously alongside the hub, providing real-time oversight.
 */

import { existsSync, readFileSync, writeFileSync, watchFile } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import logger from './shared/logger.mjs';
import { loadState, getHistory } from './shared/state.mjs';
import { discoverTasks, loadTaskRegistry } from './shared/task-loader.mjs';
import { getPendingReviews } from './shared/reviews.mjs';
import { runOptimization } from './shared/data-optimizer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OVERSEER_LOG_FILE = join(__dirname, '..', 'data', 'overseer-log.json');
const OVERSEER_STATE_FILE = join(__dirname, '..', 'data', 'overseer-state.json');

// Configuration
const CONFIG = {
  checkIntervalMs: 60000,        // Check every minute
  stuckTaskThresholdMs: 30 * 60000, // 30 minutes = stuck
  missedScheduleThresholdMs: 2 * 60 * 60000, // 2 hours late = missed
  reviewAgeAlertHours: 24,       // Alert if review pending > 24h
  failureRateAlertThreshold: 0.5, // Alert if > 50% failure rate
  maxLogEntries: 500,            // Keep last 500 log entries
  healthyRunIntervalHours: 6,    // Alert if no runs in 6 hours
  autoRecovery: {
    enabled: true,               // Enable automatic fixes
    resetStuckTasks: true,       // Auto-reset tasks stuck > threshold
    stuckResetThresholdMs: 60 * 60000 // Reset after 60 min (longer than alert threshold)
  },
  dataOptimization: {
    enabled: true,               // Enable automatic data optimization
    runEveryNChecks: 60          // Run optimization every 60 checks (~1 hour)
  }
};

const STATE_FILE = join(__dirname, '..', 'data', 'state.json');

/**
 * Overseer state
 */
let overseerState = {
  status: 'starting',
  startedAt: null,
  lastCheck: null,
  checksPerformed: 0,
  alerts: [],
  actions: []
};

let overseerLog = [];

/**
 * Load overseer state from disk
 */
function loadOverseerState() {
  try {
    if (existsSync(OVERSEER_STATE_FILE)) {
      overseerState = JSON.parse(readFileSync(OVERSEER_STATE_FILE, 'utf8'));
    }
  } catch (error) {
    logger.warn('Could not load overseer state', { error: error.message });
  }
}

/**
 * Save overseer state to disk
 */
function saveOverseerState() {
  try {
    writeFileSync(OVERSEER_STATE_FILE, JSON.stringify(overseerState, null, 2));
  } catch (error) {
    logger.error('Failed to save overseer state', { error: error.message });
  }
}

/**
 * Load overseer log from disk
 */
function loadOverseerLog() {
  try {
    if (existsSync(OVERSEER_LOG_FILE)) {
      overseerLog = JSON.parse(readFileSync(OVERSEER_LOG_FILE, 'utf8'));
    }
  } catch (error) {
    logger.warn('Could not load overseer log', { error: error.message });
    overseerLog = [];
  }
}

/**
 * Save overseer log to disk
 */
function saveOverseerLog() {
  try {
    // Keep only recent entries
    if (overseerLog.length > CONFIG.maxLogEntries) {
      overseerLog = overseerLog.slice(-CONFIG.maxLogEntries);
    }
    writeFileSync(OVERSEER_LOG_FILE, JSON.stringify(overseerLog, null, 2));
  } catch (error) {
    logger.error('Failed to save overseer log', { error: error.message });
  }
}

/**
 * Add entry to overseer log
 */
function log(type, message, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    type,
    message,
    ...details
  };

  overseerLog.push(entry);

  // Also log to console with appropriate level
  if (type === 'alert' || type === 'error') {
    logger.warn(`[OVERSEER] ${message}`, details);
  } else if (type === 'action') {
    logger.info(`[OVERSEER] ${message}`, details);
  } else {
    logger.debug(`[OVERSEER] ${message}`, details);
  }

  return entry;
}

/**
 * Auto-recovery: Reset a stuck task
 */
function resetStuckTask(taskName) {
  try {
    const stateContent = readFileSync(STATE_FILE, 'utf8');
    const state = JSON.parse(stateContent);

    if (state.tasks?.[taskName]?.currentRun) {
      delete state.tasks[taskName].currentRun;
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

      log('action', `Auto-reset stuck task: ${taskName}`, {
        action: 'reset_stuck_task',
        task: taskName
      });

      return true;
    }
  } catch (error) {
    log('error', `Failed to reset task ${taskName}`, { error: error.message });
  }
  return false;
}

/**
 * Check for stuck tasks (running too long)
 */
function checkStuckTasks(hubState) {
  const issues = [];
  const actionsPerformed = [];

  Object.entries(hubState.tasks || {}).forEach(([taskName, taskState]) => {
    if (taskState.currentRun?.status === 'running') {
      const startTime = new Date(taskState.currentRun.startedAt).getTime();
      const runningTime = Date.now() - startTime;

      if (runningTime > CONFIG.stuckTaskThresholdMs) {
        const minutes = Math.round(runningTime / 60000);

        // Check if we should auto-recover
        if (CONFIG.autoRecovery.enabled &&
            CONFIG.autoRecovery.resetStuckTasks &&
            runningTime > CONFIG.autoRecovery.stuckResetThresholdMs) {
          // Auto-reset the stuck task
          if (resetStuckTask(taskName)) {
            actionsPerformed.push({
              action: 'reset_stuck_task',
              task: taskName,
              runningMinutes: minutes
            });
            // Don't add to issues since we fixed it
            return;
          }
        }

        issues.push({
          task: taskName,
          issue: 'stuck',
          runningMinutes: minutes,
          startedAt: taskState.currentRun.startedAt,
          canAutoFix: CONFIG.autoRecovery.enabled
        });

        log('alert', `Task "${taskName}" appears stuck`, {
          runningMinutes: minutes,
          threshold: CONFIG.stuckTaskThresholdMs / 60000
        });
      }
    }
  });

  return { issues, actionsPerformed };
}

/**
 * Check for missed schedules
 */
function checkMissedSchedules(hubState) {
  const issues = [];
  const tasks = discoverTasks();
  const registry = loadTaskRegistry();
  const now = Date.now();

  tasks.forEach(task => {
    const regEntry = registry[task.name];
    if (regEntry?.enabled === false) return;

    const taskState = hubState.tasks?.[task.name];
    const lastRun = taskState?.lastRun ? new Date(taskState.lastRun).getTime() : 0;

    // Get expected run interval from cooldown
    const cooldownMs = (regEntry?.cooldownHours || 24) * 60 * 60 * 1000;
    const expectedNextRun = lastRun + cooldownMs;

    // Check if we're significantly past the expected run time
    if (lastRun > 0 && now > expectedNextRun + CONFIG.missedScheduleThresholdMs) {
      const hoursOverdue = Math.round((now - expectedNextRun) / (60 * 60 * 1000));

      issues.push({
        task: task.name,
        issue: 'missed_schedule',
        hoursOverdue,
        lastRun: taskState.lastRun
      });

      log('alert', `Task "${task.name}" may have missed its schedule`, {
        hoursOverdue,
        lastRun: taskState.lastRun
      });
    }
  });

  return issues;
}

/**
 * Check review queue health
 */
function checkReviewQueue() {
  const issues = [];

  try {
    const pending = getPendingReviews();
    const now = Date.now();

    pending.forEach(review => {
      const createdAt = new Date(review.createdAt).getTime();
      const ageHours = (now - createdAt) / (60 * 60 * 1000);

      if (ageHours > CONFIG.reviewAgeAlertHours) {
        issues.push({
          type: 'stale_review',
          reviewId: review.id,
          title: review.title,
          ageHours: Math.round(ageHours)
        });

        log('alert', `Review "${review.title}" has been pending for ${Math.round(ageHours)} hours`, {
          reviewId: review.id,
          ageHours: Math.round(ageHours)
        });
      }
    });

    // Also alert if queue is getting large
    if (pending.length >= 5) {
      issues.push({
        type: 'large_review_queue',
        count: pending.length
      });

      log('alert', `Review queue has ${pending.length} pending items`, {
        count: pending.length
      });
    }
  } catch (error) {
    log('error', 'Failed to check review queue', { error: error.message });
  }

  return issues;
}

/**
 * Check overall system health
 */
function checkSystemHealth(hubState) {
  const issues = [];
  const history = getHistory(100);

  // Check for no recent activity
  if (history.length > 0) {
    const lastActivity = new Date(history[0].timestamp).getTime();
    const hoursSinceActivity = (Date.now() - lastActivity) / (60 * 60 * 1000);

    if (hoursSinceActivity > CONFIG.healthyRunIntervalHours) {
      issues.push({
        type: 'no_recent_activity',
        hoursSinceActivity: Math.round(hoursSinceActivity)
      });

      log('alert', `No task activity in ${Math.round(hoursSinceActivity)} hours`, {
        lastActivity: history[0].timestamp
      });
    }
  }

  // Check failure rate (last 20 runs)
  const recentRuns = history.slice(0, 20);
  if (recentRuns.length >= 5) {
    const failures = recentRuns.filter(r => !r.success).length;
    const failureRate = failures / recentRuns.length;

    if (failureRate > CONFIG.failureRateAlertThreshold) {
      issues.push({
        type: 'high_failure_rate',
        failureRate: Math.round(failureRate * 100),
        recentFailures: failures,
        recentTotal: recentRuns.length
      });

      log('alert', `High failure rate: ${Math.round(failureRate * 100)}% of recent runs failed`, {
        failures,
        total: recentRuns.length
      });
    }
  }

  return issues;
}

/**
 * Generate health summary
 */
function generateHealthSummary(hubState) {
  const tasks = discoverTasks();
  const registry = loadTaskRegistry();
  const history = getHistory(100);
  const pending = getPendingReviews();

  const enabledTasks = tasks.filter(t => registry[t.name]?.enabled !== false);
  const runningTasks = Object.entries(hubState.tasks || {})
    .filter(([_, s]) => s.currentRun?.status === 'running')
    .map(([name]) => name);

  // Calculate success rate
  const recentRuns = history.slice(0, 50);
  const successCount = recentRuns.filter(r => r.success).length;
  const successRate = recentRuns.length > 0
    ? Math.round((successCount / recentRuns.length) * 100)
    : 100;

  return {
    status: runningTasks.length > 0 ? 'active' : 'idle',
    enabledTasks: enabledTasks.length,
    runningTasks,
    pendingReviews: pending.length,
    successRate,
    recentRuns: recentRuns.length,
    lastActivity: history[0]?.timestamp || null
  };
}

/**
 * Main health check routine
 */
function performHealthCheck() {
  log('check', 'Performing health check');

  const hubState = loadState();
  const allIssues = [];
  const allActions = [];

  // Run all checks (some may auto-recover)
  const stuckResult = checkStuckTasks(hubState);
  allIssues.push(...stuckResult.issues);
  allActions.push(...(stuckResult.actionsPerformed || []));

  allIssues.push(...checkMissedSchedules(hubState));
  allIssues.push(...checkReviewQueue());
  allIssues.push(...checkSystemHealth(hubState));

  // Generate summary
  const summary = generateHealthSummary(hubState);

  // Update overseer state
  overseerState.lastCheck = new Date().toISOString();
  overseerState.checksPerformed++;
  overseerState.status = allIssues.length > 0 ? 'issues_detected' : 'healthy';
  overseerState.currentIssues = allIssues;
  overseerState.recentActions = allActions;
  overseerState.healthSummary = summary;
  overseerState.autoRecoveryEnabled = CONFIG.autoRecovery.enabled;

  // Log completion
  if (allActions.length > 0) {
    log('action', `Auto-recovery: ${allActions.length} action(s) taken`, {
      actions: allActions
    });
  }

  if (allIssues.length > 0) {
    log('check', `Health check complete: ${allIssues.length} issue(s) found`, {
      issueCount: allIssues.length
    });
  } else {
    log('check', 'Health check complete: All systems healthy', summary);
  }

  // Run data optimization periodically
  if (CONFIG.dataOptimization.enabled &&
      overseerState.checksPerformed % CONFIG.dataOptimization.runEveryNChecks === 0) {
    try {
      const optimizationResult = runOptimization();
      if (optimizationResult.totalSavedBytes > 0) {
        log('action', `Data optimized: saved ${optimizationResult.totalSavedKB}KB`, {
          action: 'data_optimization',
          ...optimizationResult
        });
      }
      overseerState.lastOptimization = optimizationResult;
    } catch (error) {
      log('error', 'Data optimization failed', { error: error.message });
    }
  }

  // Persist state and log
  saveOverseerState();
  saveOverseerLog();

  return { issues: allIssues, actions: allActions, summary };
}

/**
 * Main overseer loop
 */
async function main() {
  logger.info('═'.repeat(60));
  logger.info('Overseer Agent Starting');
  logger.info('═'.repeat(60));

  // Load previous state
  loadOverseerState();
  loadOverseerLog();

  // Update startup state
  overseerState.status = 'running';
  overseerState.startedAt = new Date().toISOString();
  saveOverseerState();

  log('info', 'Overseer Agent started', {
    checkInterval: CONFIG.checkIntervalMs / 1000 + 's'
  });

  // Initial check
  performHealthCheck();

  // Schedule regular checks
  setInterval(() => {
    try {
      performHealthCheck();
    } catch (error) {
      log('error', 'Health check failed', { error: error.message });
    }
  }, CONFIG.checkIntervalMs);

  // Keep running
  logger.info('Overseer Agent running. Press Ctrl+C to stop.');
}

// Handle shutdown
process.on('SIGINT', () => {
  logger.info('Overseer Agent shutting down...');
  overseerState.status = 'stopped';
  saveOverseerState();
  log('info', 'Overseer Agent stopped');
  saveOverseerLog();
  process.exit(0);
});

process.on('SIGTERM', () => {
  overseerState.status = 'stopped';
  saveOverseerState();
  process.exit(0);
});

// Export for API access
export {
  overseerState,
  overseerLog,
  performHealthCheck,
  CONFIG as overseerConfig
};

// Run if executed directly
main().catch(error => {
  logger.error('Overseer crashed', { error: error.message, stack: error.stack });
  process.exit(1);
});
