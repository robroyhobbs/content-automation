/**
 * Unified State Management for Content Automation Hub
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from './logger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const STATE_FILE = join(DATA_DIR, 'state.json');
const HISTORY_FILE = join(DATA_DIR, 'history.json');

const defaultState = {
  version: '1.0',
  lastRun: null,
  tasks: {},  // Per-task state
  global: {
    totalRuns: 0,
    totalSuccess: 0,
    totalFailure: 0
  }
};

/**
 * Load hub state
 */
export function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      const fileState = JSON.parse(readFileSync(STATE_FILE, 'utf8'));

      // Merge with defaults to ensure all required properties exist
      const state = {
        ...defaultState,
        ...fileState,
        tasks: { ...(fileState.tasks || {}) },
        global: { ...defaultState.global, ...(fileState.global || {}) }
      };

      // Reset daily counters if new day
      const today = new Date().toISOString().split('T')[0];
      for (const [taskName, taskState] of Object.entries(state.tasks)) {
        if (taskState.todayDate !== today) {
          taskState.todayCount = 0;
          taskState.todayDate = today;
        }
      }

      return state;
    }
  } catch (error) {
    logger.error('Failed to load state', { error: error.message });
  }
  return { ...defaultState, tasks: {}, global: { ...defaultState.global } };
}

/**
 * Save hub state
 */
export function saveState(state) {
  try {
    state.lastUpdated = new Date().toISOString();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    logger.error('Failed to save state', { error: error.message });
  }
}

/**
 * Get or initialize task state
 */
export function getTaskState(state, taskName) {
  if (!state.tasks[taskName]) {
    state.tasks[taskName] = {
      todayCount: 0,
      todayDate: new Date().toISOString().split('T')[0],
      totalRuns: 0,
      successCount: 0,
      failureCount: 0,
      lastRun: null,
      lastSuccess: null,
      lastError: null,
      currentRun: null,
      retryCount: 0
    };
  }
  return state.tasks[taskName];
}

/**
 * Update task state when starting
 */
export function startTask(state, taskName) {
  const taskState = getTaskState(state, taskName);
  taskState.currentRun = {
    startedAt: new Date().toISOString(),
    status: 'running'
  };
  taskState.lastRun = new Date().toISOString();
  saveState(state);
}

/**
 * Update task state when complete
 */
export function completeTask(state, taskName, success, result = {}) {
  const taskState = getTaskState(state, taskName);

  taskState.currentRun = null;
  taskState.totalRuns++;

  if (success) {
    taskState.successCount++;
    taskState.todayCount++;
    taskState.lastSuccess = new Date().toISOString();
    taskState.lastError = null;
    taskState.retryCount = 0;
    state.global.totalSuccess++;
  } else {
    taskState.failureCount++;
    taskState.lastError = result.error || 'Unknown error';
    taskState.retryCount++;
    state.global.totalFailure++;
  }

  state.global.totalRuns++;

  // Add to history
  addToHistory(taskName, success, result);

  saveState(state);
}

/**
 * Check if task can run (within limits)
 */
export function canTaskRun(state, taskName, config) {
  const taskState = getTaskState(state, taskName);
  const now = new Date();

  // Check daily limit
  const dailyLimit = config.dailyLimit || 999;
  if (taskState.todayCount >= dailyLimit) {
    return { canRun: false, reason: `Daily limit reached (${taskState.todayCount}/${dailyLimit})` };
  }

  // Check cooldown (1 hour default)
  const cooldownMs = (config.cooldownMinutes || 60) * 60 * 1000;
  if (taskState.lastRun) {
    const lastRunTime = new Date(taskState.lastRun);
    if (now - lastRunTime < cooldownMs) {
      const minutesAgo = Math.round((now - lastRunTime) / 60000);
      return { canRun: false, reason: `Cooldown: last run ${minutesAgo}m ago` };
    }
  }

  // Check max retries
  const maxRetries = config.maxRetries || 2;
  if (taskState.retryCount >= maxRetries) {
    return { canRun: false, reason: `Max retries exceeded (${taskState.retryCount}/${maxRetries})` };
  }

  // Check if already running
  if (taskState.currentRun) {
    return { canRun: false, reason: 'Task already running' };
  }

  return { canRun: true, reason: 'Ready' };
}

/**
 * Add entry to history
 */
function addToHistory(taskName, success, result) {
  try {
    let history = { entries: [] };
    if (existsSync(HISTORY_FILE)) {
      history = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
    }

    history.entries.push({
      task: taskName,
      timestamp: new Date().toISOString(),
      success,
      ...result
    });

    // Keep last 500 entries
    if (history.entries.length > 500) {
      history.entries = history.entries.slice(-500);
    }

    writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (error) {
    logger.error('Failed to update history', { error: error.message });
  }
}

/**
 * Get recent history
 */
export function getHistory(limit = 50) {
  try {
    if (existsSync(HISTORY_FILE)) {
      const history = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
      return history.entries.slice(-limit).reverse();
    }
  } catch (error) {
    logger.error('Failed to load history', { error: error.message });
  }
  return [];
}

export default {
  loadState,
  saveState,
  getTaskState,
  startTask,
  completeTask,
  canTaskRun,
  getHistory
};
