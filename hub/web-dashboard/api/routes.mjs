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
