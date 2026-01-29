/**
 * API Routes for Web Dashboard
 */

import { Router } from 'express';
import { loadState, getHistory } from '../../shared/state.mjs';
import { discoverTasks, loadTaskRegistry } from '../../shared/task-loader.mjs';
import {
  loadReviews,
  getPendingReviews,
  approveReview,
  rejectReview,
  getReview
} from '../../shared/reviews.mjs';
import {
  loadLearning,
  generateInsights,
  getLearningSummary
} from '../../shared/learning.mjs';
import {
  runOptimization,
  getStorageStats
} from '../../shared/data-optimizer.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OVERSEER_STATE_FILE = join(__dirname, '..', '..', '..', 'data', 'overseer-state.json');
const OVERSEER_LOG_FILE = join(__dirname, '..', '..', '..', 'data', 'overseer-log.json');

const router = Router();

// ═══════════════════════════════════════════════════════════════
// GET /api/state - Current hub state
// ═══════════════════════════════════════════════════════════════
router.get('/state', (req, res) => {
  try {
    const state = loadState();
    res.json(state);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/tasks - All tasks with config and state
// ═══════════════════════════════════════════════════════════════
router.get('/tasks', (req, res) => {
  try {
    const state = loadState();
    const tasks = discoverTasks();
    const registry = loadTaskRegistry();

    const enriched = tasks.map(task => {
      const regEntry = registry[task.name] || {};
      const taskState = state.tasks?.[task.name] || {};

      return {
        name: task.name,
        config: {
          ...task.config,
          ...regEntry
        },
        enabled: regEntry.enabled !== false,
        schedule: regEntry.schedule || task.config?.schedule,
        category: regEntry.category || task.config?.category || 'uncategorized',
        description: regEntry.description || task.config?.description || '',
        state: {
          lastRun: taskState.lastRun || null,
          lastSuccess: taskState.lastSuccess || null,
          lastError: taskState.lastError || null,
          todayCount: taskState.todayCount || 0,
          totalRuns: taskState.totalRuns || 0,
          successCount: taskState.successCount || 0,
          failureCount: taskState.failureCount || 0,
          isRunning: taskState.currentRun?.status === 'running'
        }
      };
    });

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/history - Recent task execution history
// ═══════════════════════════════════════════════════════════════
router.get('/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const history = getHistory(limit);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/reviews - All reviews (pending, completed, rejected)
// ═══════════════════════════════════════════════════════════════
router.get('/reviews', (req, res) => {
  try {
    const reviews = loadReviews();
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/reviews/pending - Pending reviews only
// ═══════════════════════════════════════════════════════════════
router.get('/reviews/pending', (req, res) => {
  try {
    const pending = getPendingReviews();
    res.json(pending);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/reviews/:id - Single review details
// ═══════════════════════════════════════════════════════════════
router.get('/reviews/:id', (req, res) => {
  try {
    const review = getReview(req.params.id);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }
    res.json(review);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/reviews/:id/approve - Approve a review
// ═══════════════════════════════════════════════════════════════
router.post('/reviews/:id/approve', (req, res) => {
  try {
    const { notes } = req.body || {};
    const result = approveReview(req.params.id, notes);
    if (!result) {
      return res.status(404).json({ error: 'Review not found or already processed' });
    }
    res.json({ success: true, message: 'Review approved' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/reviews/:id/reject - Reject a review
// ═══════════════════════════════════════════════════════════════
router.post('/reviews/:id/reject', (req, res) => {
  try {
    const { reason } = req.body || {};
    const result = rejectReview(req.params.id, reason);
    if (!result) {
      return res.status(404).json({ error: 'Review not found or already processed' });
    }
    res.json({ success: true, message: 'Review rejected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/stats - Aggregated statistics
// ═══════════════════════════════════════════════════════════════
router.get('/stats', (req, res) => {
  try {
    const state = loadState();
    const history = getHistory(500);
    const reviews = loadReviews();

    const today = new Date().toISOString().split('T')[0];

    // Calculate today's stats from history
    const todayEntries = history.filter(h =>
      h.timestamp && h.timestamp.startsWith(today)
    );

    const todayCompleted = todayEntries.filter(h => h.success).length;
    const todayFailed = todayEntries.filter(h => !h.success).length;

    // Calculate success rate
    const totalRuns = state.global?.totalRuns || 0;
    const totalSuccess = state.global?.totalSuccess || 0;
    const successRate = totalRuns > 0 ? ((totalSuccess / totalRuns) * 100).toFixed(1) : 0;

    // Per-task stats
    const byTask = {};
    Object.entries(state.tasks || {}).forEach(([name, taskState]) => {
      byTask[name] = {
        totalRuns: taskState.totalRuns || 0,
        successCount: taskState.successCount || 0,
        failureCount: taskState.failureCount || 0,
        lastRun: taskState.lastRun
      };
    });

    res.json({
      today: {
        date: today,
        completed: todayCompleted,
        failed: todayFailed,
        total: todayCompleted + todayFailed
      },
      global: {
        totalRuns,
        totalSuccess,
        totalFailure: state.global?.totalFailure || 0,
        successRate: parseFloat(successRate)
      },
      reviews: {
        pending: reviews.pending?.length || 0,
        completed: reviews.completed?.length || 0,
        rejected: reviews.rejected?.length || 0
      },
      byTask
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/timeline - Timeline data for a specific day
// ═══════════════════════════════════════════════════════════════
router.get('/timeline', (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().split('T')[0];
    const history = getHistory(500);
    const tasks = discoverTasks();
    const registry = loadTaskRegistry();

    // Filter history for the requested date
    const dayHistory = history.filter(h =>
      h.timestamp && h.timestamp.startsWith(dateStr)
    );

    // Group by hour
    const hourlyData = {};
    for (let hour = 6; hour <= 20; hour++) {
      hourlyData[hour] = {
        hour,
        scheduled: [],
        completed: [],
        failed: []
      };
    }

    // Add completed/failed tasks to timeline
    dayHistory.forEach(entry => {
      const hour = new Date(entry.timestamp).getHours();
      if (hour >= 6 && hour <= 20) {
        if (entry.success) {
          hourlyData[hour].completed.push(entry.task);
        } else {
          hourlyData[hour].failed.push(entry.task);
        }
      }
    });

    // Parse scheduled tasks (from cron expressions)
    tasks.forEach(task => {
      const regEntry = registry[task.name];
      if (regEntry?.enabled === false) return;

      const schedule = regEntry?.schedule || task.config?.schedule;
      if (!schedule) return;

      // Simple cron parsing for "0 H * * *" format
      const match = schedule.match(/^\d+\s+(\d+)/);
      if (match) {
        const hour = parseInt(match[1]);
        if (hour >= 6 && hour <= 20) {
          hourlyData[hour].scheduled.push(task.name);
        }
      }
    });

    res.json({
      date: dateStr,
      hours: Object.values(hourlyData)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/publish/:task/:version - Publish approved content
// ═══════════════════════════════════════════════════════════════
router.post('/publish/:task/:version', async (req, res) => {
  try {
    const { task, version } = req.params;

    // Only arcsphere-social-weekly supports publishing for now
    if (task !== 'arcsphere-social-weekly') {
      return res.status(400).json({ error: `Task ${task} does not support publishing` });
    }

    // Dynamically import the task runner
    const taskPath = join(__dirname, '..', '..', '..', 'tasks', task, 'runner.mjs');
    const runner = await import(taskPath);

    if (!runner.publish) {
      return res.status(400).json({ error: 'Task does not have a publish function' });
    }

    // Load task config
    const tasks = discoverTasks();
    const taskConfig = tasks.find(t => t.name === task);

    if (!taskConfig) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Create context
    const context = {
      config: taskConfig.config,
      logger: {
        info: (...args) => console.log(`[${task}]`, ...args),
        warn: (...args) => console.warn(`[${task}]`, ...args),
        error: (...args) => console.error(`[${task}]`, ...args)
      }
    };

    // Execute publish
    const result = await runner.publish(context, version);

    res.json(result);
  } catch (error) {
    console.error('Publish error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/drafts/:task/:version - Get draft content for review
// ═══════════════════════════════════════════════════════════════
router.get('/drafts/:task/:version', async (req, res) => {
  try {
    const { task, version } = req.params;

    if (task !== 'arcsphere-social-weekly') {
      return res.status(400).json({ error: `Task ${task} does not have drafts` });
    }

    const draftsDir = join(__dirname, '..', '..', '..', 'campaigns', 'arcsphere-releases', 'drafts', version);

    const { readdir, readFile } = await import('fs/promises');

    const files = await readdir(draftsDir);
    const drafts = {};

    for (const file of files) {
      if (file.endsWith('.md')) {
        const content = await readFile(join(draftsDir, file), 'utf-8');
        drafts[file.replace('.md', '')] = content;
      }
    }

    res.json({
      version,
      drafts
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Drafts not found for this version' });
    }
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/credentials/status - Check social media credentials
// ═══════════════════════════════════════════════════════════════
router.get('/credentials/status', async (req, res) => {
  try {
    const posterPath = join(__dirname, '..', '..', 'shared', 'social-poster.mjs');
    const poster = await import(posterPath);

    const status = await poster.getCredentialStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/logs/:type - View logs (hub, overseer, task)
// ═══════════════════════════════════════════════════════════════
router.get('/logs/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const lines = parseInt(req.query.lines) || 100;
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');

    let logPath;
    const logsDir = join(__dirname, '..', '..', '..', 'logs');
    const today = new Date().toISOString().split('T')[0];

    switch (type) {
      case 'hub':
        logPath = join(logsDir, `hub-${today}.log`);
        break;
      case 'overseer':
        logPath = join(logsDir, 'overseer-stdout.log');
        break;
      case 'launchd':
        logPath = join(logsDir, 'launchd-stdout.log');
        break;
      case 'errors':
        logPath = join(logsDir, 'launchd-stderr.log');
        break;
      default:
        return res.status(400).json({ error: 'Unknown log type. Use: hub, overseer, launchd, errors' });
    }

    try {
      const content = await readFile(logPath, 'utf-8');
      const allLines = content.trim().split('\n');
      const recentLines = allLines.slice(-lines);

      res.json({
        type,
        path: logPath,
        lines: recentLines.length,
        content: recentLines
      });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.json({ type, path: logPath, lines: 0, content: [] });
      }
      throw err;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/overseer/fix/:action - Trigger overseer fix action
// ═══════════════════════════════════════════════════════════════
router.post('/overseer/fix/:action', async (req, res) => {
  try {
    const { action } = req.params;
    const { taskName } = req.body || {};
    const state = loadState();

    switch (action) {
      case 'reset-stuck': {
        // Reset a stuck task
        if (!taskName) {
          return res.status(400).json({ error: 'taskName required' });
        }
        if (state.tasks?.[taskName]?.currentRun) {
          delete state.tasks[taskName].currentRun;
          const { writeFileSync } = await import('fs');
          const statePath = join(__dirname, '..', '..', '..', 'data', 'state.json');
          writeFileSync(statePath, JSON.stringify(state, null, 2));

          res.json({ success: true, message: `Reset stuck task: ${taskName}` });
        } else {
          res.json({ success: false, message: 'Task is not stuck' });
        }
        break;
      }

      case 'reset-all-stuck': {
        // Reset all stuck tasks
        let resetCount = 0;
        Object.keys(state.tasks || {}).forEach(name => {
          if (state.tasks[name]?.currentRun) {
            delete state.tasks[name].currentRun;
            resetCount++;
          }
        });

        if (resetCount > 0) {
          const { writeFileSync } = await import('fs');
          const statePath = join(__dirname, '..', '..', '..', 'data', 'state.json');
          writeFileSync(statePath, JSON.stringify(state, null, 2));
        }

        res.json({ success: true, message: `Reset ${resetCount} stuck task(s)` });
        break;
      }

      default:
        res.status(400).json({ error: 'Unknown action. Use: reset-stuck, reset-all-stuck' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/task/:name/details - Get detailed task info including recent errors
// ═══════════════════════════════════════════════════════════════
router.get('/task/:name/details', async (req, res) => {
  try {
    const { name } = req.params;
    const state = loadState();
    const history = getHistory(100);
    const tasks = discoverTasks();
    const registry = loadTaskRegistry();

    const taskConfig = tasks.find(t => t.name === name);
    const regEntry = registry[name];
    const taskState = state.tasks?.[name];

    if (!taskConfig && !taskState) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Get recent history for this task
    const taskHistory = history
      .filter(h => h.task === name)
      .slice(0, 10);

    // Read task-specific logs if they exist
    let recentLogs = [];
    try {
      const { readFile } = await import('fs/promises');
      const today = new Date().toISOString().split('T')[0];
      const logPath = join(__dirname, '..', '..', '..', 'logs', `hub-${today}.log`);
      const content = await readFile(logPath, 'utf-8');
      const lines = content.split('\n');
      recentLogs = lines
        .filter(line => line.includes(name))
        .slice(-20);
    } catch (e) {
      // No logs available
    }

    res.json({
      name,
      config: {
        ...taskConfig?.config,
        ...regEntry
      },
      state: taskState || {},
      recentRuns: taskHistory,
      recentLogs
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/schedule/tomorrow - Tomorrow's scheduled tasks
// ═══════════════════════════════════════════════════════════════
router.get('/schedule/tomorrow', (req, res) => {
  try {
    const tasks = discoverTasks();
    const registry = loadTaskRegistry();

    // Get tomorrow's date
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDay = tomorrow.getDay(); // 0=Sun, 1=Mon, etc.
    const tomorrowStr = tomorrow.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    });

    const scheduled = [];

    tasks.forEach(task => {
      const regEntry = registry[task.name];
      if (!regEntry || regEntry.enabled === false) return;

      const schedule = regEntry.schedule || task.config?.schedule;
      if (!schedule) return;

      // Parse cron: "M H * * D" or "M H * * *"
      const parts = schedule.split(/\s+/);
      if (parts.length < 5) return;

      const [minute, hour, , , dayOfWeek] = parts;

      // Check if task runs tomorrow
      let runsOnDay = false;
      if (dayOfWeek === '*') {
        runsOnDay = true; // Runs every day
      } else {
        const days = dayOfWeek.split(',').map(d => parseInt(d));
        runsOnDay = days.includes(tomorrowDay);
      }

      if (runsOnDay) {
        const h = parseInt(hour);
        const m = parseInt(minute);
        const timeStr = `${h > 12 ? h - 12 : h || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;

        scheduled.push({
          name: task.name,
          category: regEntry.category || 'general',
          description: regEntry.description || '',
          time: timeStr,
          hour: h,
          minute: m,
          schedule
        });
      }
    });

    // Sort by time
    scheduled.sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));

    res.json({
      date: tomorrowStr,
      dayOfWeek: tomorrowDay,
      tasks: scheduled
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/learning/summary - Learning loop summary
// ═══════════════════════════════════════════════════════════════
router.get('/learning/summary', (req, res) => {
  try {
    const summary = getLearningSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/learning/insights - Get insights and recommendations
// ═══════════════════════════════════════════════════════════════
router.get('/learning/insights', (req, res) => {
  try {
    const { insights, recommendations } = generateInsights();
    res.json({ insights, recommendations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/learning/patterns - Get detailed patterns
// ═══════════════════════════════════════════════════════════════
router.get('/learning/patterns', (req, res) => {
  try {
    const data = loadLearning();
    res.json({
      taskPatterns: data.taskPatterns,
      timePatterns: data.timePatterns,
      errorPatterns: data.errorPatterns
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/learning/generate-insights - Force insight generation
// ═══════════════════════════════════════════════════════════════
router.post('/learning/generate-insights', (req, res) => {
  try {
    const result = generateInsights();
    res.json({
      success: true,
      insightsCount: result.insights.length,
      recommendationsCount: result.recommendations.length,
      ...result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/storage/stats - Get storage statistics
// ═══════════════════════════════════════════════════════════════
router.get('/storage/stats', (req, res) => {
  try {
    const stats = getStorageStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/storage/optimize - Run data optimization manually
// ═══════════════════════════════════════════════════════════════
router.post('/storage/optimize', (req, res) => {
  try {
    const result = runOptimization();
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/overseer/status - Overseer agent status
// ═══════════════════════════════════════════════════════════════
router.get('/overseer/status', (req, res) => {
  try {
    if (!existsSync(OVERSEER_STATE_FILE)) {
      return res.json({
        status: 'not_running',
        message: 'Overseer agent has not been started'
      });
    }

    const state = JSON.parse(readFileSync(OVERSEER_STATE_FILE, 'utf8'));
    res.json(state);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/overseer/log - Overseer activity log
// ═══════════════════════════════════════════════════════════════
router.get('/overseer/log', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;

    if (!existsSync(OVERSEER_LOG_FILE)) {
      return res.json([]);
    }

    const log = JSON.parse(readFileSync(OVERSEER_LOG_FILE, 'utf8'));
    // Return most recent entries first
    const recent = log.slice(-limit).reverse();
    res.json(recent);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
