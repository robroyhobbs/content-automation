/**
 * Data Optimizer - Manages data retention and storage optimization
 *
 * Ensures the system stays lean by:
 * 1. Pruning old detailed records
 * 2. Summarizing historical data into aggregates
 * 3. Cleaning up logs and temporary files
 * 4. Running automatically as part of the overseer
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const LOGS_DIR = join(__dirname, '..', '..', 'logs');

// Retention policies
const RETENTION = {
  // Learning data
  learning: {
    maxOutcomes: 500,           // Keep last 500 detailed outcomes
    maxInsights: 50,            // Keep last 50 insights
    maxAdjustments: 100,        // Keep last 100 adjustments
    summarizeAfterDays: 7       // Summarize data older than 7 days
  },

  // Overseer logs
  overseer: {
    maxLogEntries: 200,         // Keep last 200 log entries
    maxStateHistory: 50         // Keep last 50 state snapshots
  },

  // History
  history: {
    maxEntries: 200,            // Keep last 200 history entries
    summarizeAfterDays: 14      // Summarize older entries
  },

  // Log files
  logs: {
    maxAgeDays: 7,              // Delete logs older than 7 days
    maxSizeMB: 10               // Warn if logs exceed 10MB
  }
};

/**
 * Optimize learning data
 */
function optimizeLearning() {
  const learningFile = join(DATA_DIR, 'learning.json');
  if (!existsSync(learningFile)) return { action: 'skipped', reason: 'no file' };

  try {
    const data = JSON.parse(readFileSync(learningFile, 'utf8'));
    const originalSize = JSON.stringify(data).length;
    let changes = [];

    // 1. Prune old outcomes, keeping aggregates
    if (data.outcomes && data.outcomes.length > RETENTION.learning.maxOutcomes) {
      const excess = data.outcomes.length - RETENTION.learning.maxOutcomes;
      const oldOutcomes = data.outcomes.slice(0, excess);

      // Summarize old outcomes into weekly aggregates before removing
      summarizeOutcomes(data, oldOutcomes);

      data.outcomes = data.outcomes.slice(-RETENTION.learning.maxOutcomes);
      changes.push(`pruned ${excess} old outcomes`);
    }

    // 2. Limit insights
    if (data.insights && data.insights.length > RETENTION.learning.maxInsights) {
      data.insights = data.insights.slice(-RETENTION.learning.maxInsights);
      changes.push('pruned old insights');
    }

    // 3. Limit adjustments
    if (data.adjustments && data.adjustments.length > RETENTION.learning.maxAdjustments) {
      data.adjustments = data.adjustments.slice(-RETENTION.learning.maxAdjustments);
      changes.push('pruned old adjustments');
    }

    // 4. Clean up empty or stale pattern data
    cleanupPatterns(data);

    // Save if changes were made
    if (changes.length > 0) {
      data.lastOptimized = new Date().toISOString();
      writeFileSync(learningFile, JSON.stringify(data, null, 2));

      const newSize = JSON.stringify(data).length;
      return {
        action: 'optimized',
        changes,
        sizeBefore: originalSize,
        sizeAfter: newSize,
        saved: originalSize - newSize
      };
    }

    return { action: 'no_changes', size: originalSize };
  } catch (error) {
    return { action: 'error', error: error.message };
  }
}

/**
 * Summarize old outcomes into weekly aggregates
 */
function summarizeOutcomes(data, oldOutcomes) {
  if (!data.weeklyMetrics) data.weeklyMetrics = [];

  // Group by week
  const weekMap = {};
  oldOutcomes.forEach(outcome => {
    const date = new Date(outcome.timestamp);
    const weekStart = getWeekStart(date);
    const weekKey = weekStart.toISOString().split('T')[0];

    if (!weekMap[weekKey]) {
      weekMap[weekKey] = {
        weekStart: weekKey,
        totalRuns: 0,
        successes: 0,
        failures: 0,
        taskBreakdown: {},
        errorBreakdown: {}
      };
    }

    const week = weekMap[weekKey];
    week.totalRuns++;
    if (outcome.success) {
      week.successes++;
    } else {
      week.failures++;
      if (outcome.errorType) {
        week.errorBreakdown[outcome.errorType] = (week.errorBreakdown[outcome.errorType] || 0) + 1;
      }
    }

    if (outcome.task) {
      if (!week.taskBreakdown[outcome.task]) {
        week.taskBreakdown[outcome.task] = { runs: 0, successes: 0 };
      }
      week.taskBreakdown[outcome.task].runs++;
      if (outcome.success) week.taskBreakdown[outcome.task].successes++;
    }
  });

  // Merge into weeklyMetrics
  Object.values(weekMap).forEach(week => {
    week.successRate = week.totalRuns > 0
      ? ((week.successes / week.totalRuns) * 100).toFixed(1)
      : 0;

    // Check if we already have this week
    const existingIdx = data.weeklyMetrics.findIndex(w => w.weekStart === week.weekStart);
    if (existingIdx >= 0) {
      // Merge with existing
      const existing = data.weeklyMetrics[existingIdx];
      existing.totalRuns += week.totalRuns;
      existing.successes += week.successes;
      existing.failures += week.failures;
      existing.successRate = ((existing.successes / existing.totalRuns) * 100).toFixed(1);
    } else {
      data.weeklyMetrics.push(week);
    }
  });

  // Keep only last 52 weeks of metrics
  if (data.weeklyMetrics.length > 52) {
    data.weeklyMetrics = data.weeklyMetrics.slice(-52);
  }
}

/**
 * Clean up stale patterns
 */
function cleanupPatterns(data) {
  // Remove task patterns with very low sample sizes that are old
  const now = Date.now();
  const staleThreshold = 30 * 24 * 60 * 60 * 1000; // 30 days

  if (data.taskPatterns) {
    Object.keys(data.taskPatterns).forEach(task => {
      const pattern = data.taskPatterns[task];
      // If task has < 3 runs and hasn't been updated in 30 days, consider removing
      // (We don't have lastUpdated on patterns, so skip this for now)
    });
  }
}

/**
 * Optimize overseer logs
 */
function optimizeOverseerLogs() {
  const logFile = join(DATA_DIR, 'overseer-log.json');
  if (!existsSync(logFile)) return { action: 'skipped', reason: 'no file' };

  try {
    const logs = JSON.parse(readFileSync(logFile, 'utf8'));
    const originalSize = JSON.stringify(logs).length;

    if (logs.length > RETENTION.overseer.maxLogEntries) {
      const pruned = logs.length - RETENTION.overseer.maxLogEntries;
      const optimized = logs.slice(-RETENTION.overseer.maxLogEntries);
      writeFileSync(logFile, JSON.stringify(optimized, null, 2));

      return {
        action: 'optimized',
        pruned,
        sizeBefore: originalSize,
        sizeAfter: JSON.stringify(optimized).length
      };
    }

    return { action: 'no_changes', entries: logs.length };
  } catch (error) {
    return { action: 'error', error: error.message };
  }
}

/**
 * Optimize history file
 */
function optimizeHistory() {
  const historyFile = join(DATA_DIR, 'history.json');
  if (!existsSync(historyFile)) return { action: 'skipped', reason: 'no file' };

  try {
    const history = JSON.parse(readFileSync(historyFile, 'utf8'));
    const originalSize = JSON.stringify(history).length;

    if (history.length > RETENTION.history.maxEntries) {
      const pruned = history.length - RETENTION.history.maxEntries;
      const optimized = history.slice(-RETENTION.history.maxEntries);
      writeFileSync(historyFile, JSON.stringify(optimized, null, 2));

      return {
        action: 'optimized',
        pruned,
        sizeBefore: originalSize,
        sizeAfter: JSON.stringify(optimized).length
      };
    }

    return { action: 'no_changes', entries: history.length };
  } catch (error) {
    return { action: 'error', error: error.message };
  }
}

/**
 * Clean up old log files
 */
function cleanupLogFiles() {
  if (!existsSync(LOGS_DIR)) return { action: 'skipped', reason: 'no logs dir' };

  try {
    const files = readdirSync(LOGS_DIR);
    const now = Date.now();
    const maxAge = RETENTION.logs.maxAgeDays * 24 * 60 * 60 * 1000;
    const deleted = [];
    let totalSize = 0;

    files.forEach(file => {
      const filePath = join(LOGS_DIR, file);
      try {
        const stat = statSync(filePath);
        totalSize += stat.size;

        // Delete old log files (but keep current ones)
        if (file.match(/hub-\d{4}-\d{2}-\d{2}\.log/) || file.match(/\.log\.\d+$/)) {
          const age = now - stat.mtimeMs;
          if (age > maxAge) {
            unlinkSync(filePath);
            deleted.push(file);
          }
        }
      } catch (e) {
        // Skip files we can't stat
      }
    });

    return {
      action: deleted.length > 0 ? 'cleaned' : 'no_changes',
      deleted,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      warning: totalSize > RETENTION.logs.maxSizeMB * 1024 * 1024
        ? `Logs exceed ${RETENTION.logs.maxSizeMB}MB`
        : null
    };
  } catch (error) {
    return { action: 'error', error: error.message };
  }
}

/**
 * Get start of week (Sunday) for a date
 */
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Run full optimization
 */
export function runOptimization() {
  const results = {
    timestamp: new Date().toISOString(),
    learning: optimizeLearning(),
    overseerLogs: optimizeOverseerLogs(),
    history: optimizeHistory(),
    logFiles: cleanupLogFiles()
  };

  // Calculate total savings
  let totalSaved = 0;
  if (results.learning.saved) totalSaved += results.learning.saved;
  if (results.overseerLogs.sizeBefore && results.overseerLogs.sizeAfter) {
    totalSaved += results.overseerLogs.sizeBefore - results.overseerLogs.sizeAfter;
  }
  if (results.history.sizeBefore && results.history.sizeAfter) {
    totalSaved += results.history.sizeBefore - results.history.sizeAfter;
  }

  results.totalSavedBytes = totalSaved;
  results.totalSavedKB = (totalSaved / 1024).toFixed(2);

  return results;
}

/**
 * Get storage stats
 */
export function getStorageStats() {
  const stats = {
    data: {},
    logs: {},
    total: 0
  };

  // Check data files
  if (existsSync(DATA_DIR)) {
    const files = readdirSync(DATA_DIR);
    files.forEach(file => {
      try {
        const filePath = join(DATA_DIR, file);
        const stat = statSync(filePath);
        if (stat.isFile()) {
          stats.data[file] = {
            size: stat.size,
            sizeKB: (stat.size / 1024).toFixed(2),
            modified: stat.mtime
          };
          stats.total += stat.size;
        }
      } catch (e) {}
    });
  }

  // Check log files
  if (existsSync(LOGS_DIR)) {
    const files = readdirSync(LOGS_DIR);
    files.forEach(file => {
      try {
        const filePath = join(LOGS_DIR, file);
        const stat = statSync(filePath);
        if (stat.isFile()) {
          stats.logs[file] = {
            size: stat.size,
            sizeKB: (stat.size / 1024).toFixed(2),
            modified: stat.mtime
          };
          stats.total += stat.size;
        }
      } catch (e) {}
    });
  }

  stats.totalMB = (stats.total / (1024 * 1024)).toFixed(2);

  return stats;
}

export default {
  runOptimization,
  getStorageStats,
  RETENTION
};
