/**
 * Learning Loop - Tracks outcomes and generates insights for self-improvement
 *
 * This module enables the system to:
 * 1. Record detailed outcomes from every task run
 * 2. Identify patterns in successes and failures
 * 3. Generate actionable recommendations
 * 4. Track improvements over time
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEARNING_FILE = join(__dirname, '..', '..', 'data', 'learning.json');

/**
 * Default learning data structure
 */
const DEFAULT_LEARNING_DATA = {
  version: '1.0',
  createdAt: new Date().toISOString(),

  // Detailed outcome records
  outcomes: [],

  // Aggregated patterns by task
  taskPatterns: {},

  // Time-based patterns
  timePatterns: {
    byHour: {},      // Success rate by hour of day
    byDayOfWeek: {}, // Success rate by day of week
  },

  // Error patterns
  errorPatterns: {},

  // Generated insights
  insights: [],

  // Recommendations for improvement
  recommendations: [],

  // Metrics over time
  weeklyMetrics: [],

  // Configuration adjustments made
  adjustments: []
};

/**
 * Load learning data from disk
 */
export function loadLearning() {
  try {
    if (existsSync(LEARNING_FILE)) {
      return JSON.parse(readFileSync(LEARNING_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('Failed to load learning data:', error.message);
  }
  return { ...DEFAULT_LEARNING_DATA };
}

/**
 * Save learning data to disk
 */
export function saveLearning(data) {
  try {
    data.lastUpdated = new Date().toISOString();
    writeFileSync(LEARNING_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Failed to save learning data:', error.message);
    return false;
  }
}

/**
 * Record a task outcome with detailed context
 */
export function recordOutcome(outcome) {
  const data = loadLearning();

  const record = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    task: outcome.task,
    success: outcome.success,

    // Context
    hour: new Date().getHours(),
    dayOfWeek: new Date().getDay(),

    // Performance metrics
    duration: outcome.duration || null,

    // Error details (if failed)
    error: outcome.error || null,
    errorType: outcome.error ? categorizeError(outcome.error) : null,

    // Output metrics (if available)
    output: {
      contentLength: outcome.output?.length || null,
      hasUrl: !!outcome.url,
      customMetrics: outcome.metrics || {}
    },

    // Task-specific context
    context: outcome.context || {}
  };

  // Add to outcomes (keep last 1000)
  data.outcomes.push(record);
  if (data.outcomes.length > 1000) {
    data.outcomes = data.outcomes.slice(-1000);
  }

  // Update patterns
  updatePatterns(data, record);

  saveLearning(data);
  return record;
}

/**
 * Categorize an error for pattern analysis
 */
function categorizeError(error) {
  const errorStr = String(error).toLowerCase();

  if (errorStr.includes('timeout')) return 'timeout';
  if (errorStr.includes('network') || errorStr.includes('fetch')) return 'network';
  if (errorStr.includes('auth') || errorStr.includes('401') || errorStr.includes('403')) return 'auth';
  if (errorStr.includes('rate limit') || errorStr.includes('429')) return 'rate_limit';
  if (errorStr.includes('not found') || errorStr.includes('404')) return 'not_found';
  if (errorStr.includes('parse') || errorStr.includes('json')) return 'parse_error';
  if (errorStr.includes('memory') || errorStr.includes('heap')) return 'memory';
  if (errorStr.includes('selector') || errorStr.includes('element')) return 'ui_element';

  return 'unknown';
}

/**
 * Update aggregated patterns based on new outcome
 */
function updatePatterns(data, record) {
  const { task, success, hour, dayOfWeek, errorType, duration } = record;

  // Initialize task patterns if needed
  if (!data.taskPatterns[task]) {
    data.taskPatterns[task] = {
      totalRuns: 0,
      successes: 0,
      failures: 0,
      avgDuration: 0,
      errorTypes: {},
      bestHour: null,
      worstHour: null,
      hourlyStats: {}
    };
  }

  const tp = data.taskPatterns[task];
  tp.totalRuns++;

  if (success) {
    tp.successes++;
  } else {
    tp.failures++;
    if (errorType) {
      tp.errorTypes[errorType] = (tp.errorTypes[errorType] || 0) + 1;
    }
  }

  // Update average duration
  if (duration) {
    tp.avgDuration = ((tp.avgDuration * (tp.totalRuns - 1)) + duration) / tp.totalRuns;
  }

  // Update hourly stats
  if (!tp.hourlyStats[hour]) {
    tp.hourlyStats[hour] = { runs: 0, successes: 0 };
  }
  tp.hourlyStats[hour].runs++;
  if (success) tp.hourlyStats[hour].successes++;

  // Calculate best/worst hours
  let bestRate = -1, worstRate = 101;
  Object.entries(tp.hourlyStats).forEach(([h, stats]) => {
    if (stats.runs >= 3) { // Need at least 3 runs for significance
      const rate = (stats.successes / stats.runs) * 100;
      if (rate > bestRate) { bestRate = rate; tp.bestHour = parseInt(h); }
      if (rate < worstRate) { worstRate = rate; tp.worstHour = parseInt(h); }
    }
  });

  // Update time patterns
  const hourKey = String(hour);
  if (!data.timePatterns.byHour[hourKey]) {
    data.timePatterns.byHour[hourKey] = { runs: 0, successes: 0 };
  }
  data.timePatterns.byHour[hourKey].runs++;
  if (success) data.timePatterns.byHour[hourKey].successes++;

  const dayKey = String(dayOfWeek);
  if (!data.timePatterns.byDayOfWeek[dayKey]) {
    data.timePatterns.byDayOfWeek[dayKey] = { runs: 0, successes: 0 };
  }
  data.timePatterns.byDayOfWeek[dayKey].runs++;
  if (success) data.timePatterns.byDayOfWeek[dayKey].successes++;

  // Update error patterns
  if (errorType) {
    if (!data.errorPatterns[errorType]) {
      data.errorPatterns[errorType] = { count: 0, tasks: {}, lastSeen: null };
    }
    data.errorPatterns[errorType].count++;
    data.errorPatterns[errorType].tasks[task] = (data.errorPatterns[errorType].tasks[task] || 0) + 1;
    data.errorPatterns[errorType].lastSeen = record.timestamp;
  }
}

/**
 * Generate insights from learning data
 */
export function generateInsights() {
  const data = loadLearning();
  const insights = [];
  const recommendations = [];

  // Analyze task patterns
  Object.entries(data.taskPatterns).forEach(([task, pattern]) => {
    const successRate = pattern.totalRuns > 0
      ? ((pattern.successes / pattern.totalRuns) * 100).toFixed(1)
      : 0;

    // Low success rate insight
    if (pattern.totalRuns >= 5 && successRate < 70) {
      insights.push({
        type: 'low_success_rate',
        severity: successRate < 50 ? 'high' : 'medium',
        task,
        message: `${task} has ${successRate}% success rate (${pattern.successes}/${pattern.totalRuns})`,
        data: { successRate, runs: pattern.totalRuns }
      });

      // Check for specific error patterns
      const topError = Object.entries(pattern.errorTypes)
        .sort((a, b) => b[1] - a[1])[0];

      if (topError) {
        recommendations.push({
          task,
          type: 'fix_error',
          priority: 'high',
          message: `Fix ${topError[0]} errors in ${task} (${topError[1]} occurrences)`,
          action: getErrorFix(topError[0])
        });
      }
    }

    // Best time insight
    if (pattern.bestHour !== null && pattern.worstHour !== null && pattern.bestHour !== pattern.worstHour) {
      const bestStats = pattern.hourlyStats[pattern.bestHour];
      const worstStats = pattern.hourlyStats[pattern.worstHour];

      if (bestStats && worstStats) {
        const bestRate = ((bestStats.successes / bestStats.runs) * 100).toFixed(0);
        const worstRate = ((worstStats.successes / worstStats.runs) * 100).toFixed(0);

        if (bestRate - worstRate > 20) {
          insights.push({
            type: 'timing_pattern',
            severity: 'low',
            task,
            message: `${task} performs better at ${formatHour(pattern.bestHour)} (${bestRate}%) than ${formatHour(pattern.worstHour)} (${worstRate}%)`,
            data: { bestHour: pattern.bestHour, worstHour: pattern.worstHour }
          });

          recommendations.push({
            task,
            type: 'schedule_change',
            priority: 'low',
            message: `Consider scheduling ${task} at ${formatHour(pattern.bestHour)} instead`,
            action: { type: 'reschedule', hour: pattern.bestHour }
          });
        }
      }
    }
  });

  // Analyze global error patterns
  Object.entries(data.errorPatterns).forEach(([errorType, pattern]) => {
    if (pattern.count >= 5) {
      insights.push({
        type: 'recurring_error',
        severity: pattern.count >= 10 ? 'high' : 'medium',
        message: `${errorType} errors occurred ${pattern.count} times across tasks`,
        data: { errorType, count: pattern.count, tasks: Object.keys(pattern.tasks) }
      });
    }
  });

  // Store insights
  data.insights = insights;
  data.recommendations = recommendations;
  data.lastInsightGeneration = new Date().toISOString();

  saveLearning(data);

  return { insights, recommendations };
}

/**
 * Get recommended fix for an error type
 */
function getErrorFix(errorType) {
  const fixes = {
    timeout: { type: 'config', suggestion: 'Increase timeout or add retry logic' },
    network: { type: 'retry', suggestion: 'Add network retry with exponential backoff' },
    auth: { type: 'credentials', suggestion: 'Check and refresh authentication credentials' },
    rate_limit: { type: 'throttle', suggestion: 'Add rate limiting or increase delays between requests' },
    parse_error: { type: 'validation', suggestion: 'Add input validation and error handling' },
    ui_element: { type: 'selector', suggestion: 'Update selectors - UI may have changed' },
    memory: { type: 'optimization', suggestion: 'Optimize memory usage or increase limits' }
  };

  return fixes[errorType] || { type: 'investigate', suggestion: 'Manual investigation needed' };
}

/**
 * Format hour for display
 */
function formatHour(hour) {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour > 12) return `${hour - 12} PM`;
  return `${hour} AM`;
}

/**
 * Get learning summary for dashboard
 */
export function getLearningSummary() {
  const data = loadLearning();

  // Calculate overall stats
  const recentOutcomes = data.outcomes.slice(-100);
  const recentSuccesses = recentOutcomes.filter(o => o.success).length;
  const recentSuccessRate = recentOutcomes.length > 0
    ? ((recentSuccesses / recentOutcomes.length) * 100).toFixed(1)
    : 0;

  // Get top issues
  const topIssues = Object.entries(data.errorPatterns)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3)
    .map(([type, pattern]) => ({ type, count: pattern.count }));

  return {
    totalOutcomes: data.outcomes.length,
    recentSuccessRate,
    insightsCount: data.insights?.length || 0,
    recommendationsCount: data.recommendations?.length || 0,
    topIssues,
    taskCount: Object.keys(data.taskPatterns).length,
    lastUpdated: data.lastUpdated,
    lastInsightGeneration: data.lastInsightGeneration
  };
}

/**
 * Record an adjustment made based on recommendations
 */
export function recordAdjustment(adjustment) {
  const data = loadLearning();

  data.adjustments.push({
    timestamp: new Date().toISOString(),
    ...adjustment
  });

  // Keep last 100 adjustments
  if (data.adjustments.length > 100) {
    data.adjustments = data.adjustments.slice(-100);
  }

  saveLearning(data);
}

export default {
  loadLearning,
  saveLearning,
  recordOutcome,
  generateInsights,
  getLearningSummary,
  recordAdjustment
};
