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

export default router;
