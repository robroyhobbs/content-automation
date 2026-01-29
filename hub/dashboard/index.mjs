#!/usr/bin/env node
/**
 * Content Automation Hub - Live Dashboard
 * Shows 24-hour view of tasks with status tracking
 */

import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { loadState, getHistory } from '../shared/state.mjs';
import { discoverTasks, loadTaskRegistry } from '../shared/task-loader.mjs';
import { getPendingReviews, loadReviews } from '../shared/reviews.mjs';

// Create screen
const screen = blessed.screen({
  smartCSR: true,
  title: 'Content Automation Hub'
});

// Create grid layout
const grid = new contrib.grid({ rows: 12, cols: 12, screen });

// ═══════════════════════════════════════════════════════════════
// HEADER
// ═══════════════════════════════════════════════════════════════
const header = grid.set(0, 0, 1, 12, blessed.box, {
  content: '{center}{bold}CONTENT AUTOMATION HUB{/bold}{/center}',
  tags: true,
  style: { fg: 'white', bg: 'blue' }
});

// ═══════════════════════════════════════════════════════════════
// 24-HOUR TIMELINE
// ═══════════════════════════════════════════════════════════════
const timelineBox = grid.set(1, 0, 2, 12, blessed.box, {
  label: ' Today\'s Timeline (24h) ',
  tags: true,
  border: { type: 'line' },
  style: { fg: 'white', border: { fg: 'cyan' } },
  padding: { left: 1, right: 1 }
});

// ═══════════════════════════════════════════════════════════════
// TASK STATUS BOARD (Kanban-style)
// ═══════════════════════════════════════════════════════════════

// Scheduled column
const scheduledBox = grid.set(3, 0, 4, 3, blessed.list, {
  label: ' ⏰ Scheduled ',
  tags: true,
  border: { type: 'line' },
  style: {
    fg: 'white',
    border: { fg: 'gray' },
    selected: { bg: 'gray', fg: 'white' }
  },
  keys: true,
  mouse: true
});

// Running column
const runningBox = grid.set(3, 3, 4, 3, blessed.list, {
  label: ' ▶ Running ',
  tags: true,
  border: { type: 'line' },
  style: {
    fg: 'white',
    border: { fg: 'yellow' },
    selected: { bg: 'yellow', fg: 'black' }
  },
  keys: true,
  mouse: true
});

// In Review column
const reviewBox = grid.set(3, 6, 4, 3, blessed.list, {
  label: ' 👁 In Review ',
  tags: true,
  border: { type: 'line' },
  style: {
    fg: 'white',
    border: { fg: 'magenta' },
    selected: { bg: 'magenta', fg: 'white' }
  },
  keys: true,
  mouse: true
});

// Completed column
const completedBox = grid.set(3, 9, 4, 3, blessed.list, {
  label: ' ✓ Completed ',
  tags: true,
  border: { type: 'line' },
  style: {
    fg: 'white',
    border: { fg: 'green' },
    selected: { bg: 'green', fg: 'white' }
  },
  keys: true,
  mouse: true
});

// ═══════════════════════════════════════════════════════════════
// ACTIVITY LOG & STATS
// ═══════════════════════════════════════════════════════════════

// Activity Log
const activityLog = grid.set(7, 0, 3, 8, contrib.log, {
  label: ' Recent Activity ',
  fg: 'green',
  tags: true
});

// Stats Panel
const statsBox = grid.set(7, 8, 3, 4, blessed.box, {
  label: ' Today\'s Stats ',
  tags: true,
  border: { type: 'line' },
  style: { fg: 'white', border: { fg: 'cyan' } },
  padding: { left: 1 }
});

// ═══════════════════════════════════════════════════════════════
// INSTRUCTIONS
// ═══════════════════════════════════════════════════════════════
const instructionsBox = grid.set(10, 0, 2, 12, blessed.box, {
  content: ' {bold}Navigate:{/bold} [←/→] Change day  [t] Today  |  {bold}Actions:{/bold} [r] Refresh  [g] Generate  [v] Reviews  [q] Quit ',
  tags: true,
  border: { type: 'line' },
  style: { fg: 'cyan', border: { fg: 'gray' } }
});

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

let runningIndicator = 0;
let dayOffset = 0; // 0 = today, 1 = tomorrow, -1 = yesterday, etc.

function getViewDate() {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  return date;
}

function getSpinner() {
  const frames = ['◐', '◓', '◑', '◒'];
  return frames[runningIndicator % frames.length];
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatTimeShort(hour) {
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  if (hour < 12) return `${hour}a`;
  return `${hour - 12}p`;
}

function getScheduledHour(task) {
  // Parse cron schedule to get hour
  const schedule = task.config?.schedule;
  if (!schedule) return null;
  const parts = schedule.split(' ');
  if (parts.length >= 2) {
    return parseInt(parts[1], 10);
  }
  return null;
}

function isWeekday() {
  const day = new Date().getDay();
  return day >= 1 && day <= 5;
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

// ═══════════════════════════════════════════════════════════════
// MAIN REFRESH FUNCTION
// ═══════════════════════════════════════════════════════════════

function refreshDashboard() {
  const state = loadState();
  const registry = loadTaskRegistry();
  const tasks = discoverTasks();
  const history = getHistory(50);
  const reviews = loadReviews();
  const pendingReviews = reviews.pending || [];

  const now = new Date();
  const viewDate = getViewDate();
  const viewDateStr = viewDate.toISOString().split('T')[0];
  const today = getTodayDate();
  const isToday = viewDateStr === today;
  const currentHour = isToday ? now.getHours() : -1; // Only highlight current hour if viewing today
  const viewDayOfWeek = viewDate.getDay(); // 0 = Sunday, 1-5 = Mon-Fri, 6 = Saturday
  const isViewDayWeekday = viewDayOfWeek >= 1 && viewDayOfWeek <= 5;

  // ─────────────────────────────────────────────────────────────
  // Build 24-hour timeline
  // ─────────────────────────────────────────────────────────────
  const hourStatus = new Array(24).fill(' ');

  // Mark scheduled tasks on timeline
  for (const task of tasks) {
    const hour = getScheduledHour(task);
    if (hour !== null) {
      const taskState = state.tasks?.[task.name] || {};
      const isRunning = !!taskState.currentRun && isToday;
      const ranOnViewDay = taskState.lastRun && taskState.lastRun.startsWith(viewDateStr);

      if (isRunning) {
        hourStatus[hour] = '{yellow-fg}▶{/yellow-fg}';
      } else if (ranOnViewDay) {
        hourStatus[hour] = '{green-fg}✓{/green-fg}';
      } else if (isViewDayWeekday) {
        // Task is scheduled for this weekday
        if (isToday && hour <= currentHour) {
          hourStatus[hour] = '{gray-fg}○{/gray-fg}'; // Missed
        } else {
          hourStatus[hour] = '{cyan-fg}●{/cyan-fg}'; // Upcoming
        }
      } else {
        hourStatus[hour] = '{gray-fg}·{/gray-fg}'; // Weekend - no task
      }
    }
  }

  // Build timeline string
  let timeline1 = '  ';
  let timeline2 = '  ';
  for (let h = 6; h <= 20; h++) { // Show 6am to 8pm
    if (h === currentHour && isToday) {
      timeline1 += `{white-bg}{black-fg}${formatTimeShort(h).padEnd(3)}{/black-fg}{/white-bg} `;
    } else {
      timeline1 += `${formatTimeShort(h).padEnd(3)} `;
    }
    timeline2 += ` ${hourStatus[h]}  `;
  }

  // Day navigation hint
  const dayLabel = dayOffset === 0 ? 'Today' :
                   dayOffset === 1 ? 'Tomorrow' :
                   dayOffset === -1 ? 'Yesterday' :
                   viewDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const navHint = '{gray-fg}[←/→ change day]{/gray-fg}';
  const weekendNote = !isViewDayWeekday ? '  {yellow-fg}(Weekend - no scheduled tasks){/yellow-fg}' : '';

  const timelineContent = [
    `  {bold}${dayLabel}{/bold}${weekendNote}  ${navHint}`,
    timeline1,
    timeline2,
    ''
  ].join('\n');

  timelineBox.setContent(timelineContent);

  // ─────────────────────────────────────────────────────────────
  // Categorize tasks by status for the view date
  // ─────────────────────────────────────────────────────────────
  const scheduled = [];
  const running = [];
  const inReview = [];
  const completed = [];

  // Get history for the view date
  const viewDayHistory = history.filter(h => h.timestamp && h.timestamp.startsWith(viewDateStr));

  for (const task of tasks) {
    const taskState = state.tasks?.[task.name] || {};
    const regEntry = registry[task.name] || {};
    const enabled = regEntry.enabled !== false;

    if (!enabled) continue;

    const isRunning = !!taskState.currentRun && isToday;
    const ranOnViewDay = taskState.lastRun && taskState.lastRun.startsWith(viewDateStr);
    const succeededOnViewDay = taskState.lastSuccess && taskState.lastSuccess.startsWith(viewDateStr);
    const hour = getScheduledHour(task);

    if (isRunning) {
      running.push({
        name: task.name,
        status: `${getSpinner()} Running...`,
        time: taskState.currentRun?.startedAt
      });
    } else if (succeededOnViewDay) {
      completed.push({
        name: task.name,
        status: '✓ Done',
        time: taskState.lastSuccess
      });
    } else if (hour !== null && isViewDayWeekday) {
      // Show as scheduled if it's a future time on today, or any time on a future weekday
      const isFutureToday = isToday && hour > currentHour;
      const isFutureDay = dayOffset > 0;

      if (isFutureToday || isFutureDay) {
        scheduled.push({
          name: task.name,
          status: `@ ${formatTimeShort(hour)}`,
          hour: hour
        });
      }
    }
  }

  // Check for items in review (from review queue)
  for (const review of pendingReviews) {
    inReview.push({
      name: review.title?.substring(0, 20) || review.type,
      id: review.id,
      status: 'Awaiting approval'
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Update status columns
  // ─────────────────────────────────────────────────────────────

  // Scheduled
  if (scheduled.length === 0) {
    scheduledBox.setItems(['{gray-fg}None scheduled{/gray-fg}']);
  } else {
    scheduledBox.setItems(scheduled.map(t =>
      `{cyan-fg}○{/cyan-fg} ${t.name} ${t.status}`
    ));
  }
  scheduledBox.setLabel(` ⏰ Scheduled (${scheduled.length}) `);

  // Running
  if (running.length === 0) {
    runningBox.setItems(['{gray-fg}None running{/gray-fg}']);
    runningBox.style.border.fg = 'gray';
  } else {
    runningBox.setItems(running.map(t =>
      `{yellow-fg}▶{/yellow-fg} ${t.name}`
    ));
    runningBox.style.border.fg = 'yellow';
  }
  runningBox.setLabel(` ▶ Running (${running.length}) `);

  // In Review
  if (inReview.length === 0) {
    reviewBox.setItems(['{gray-fg}None pending{/gray-fg}']);
    reviewBox.style.border.fg = 'gray';
  } else {
    reviewBox.setItems(inReview.map(t =>
      `{magenta-fg}●{/magenta-fg} ${t.name}`
    ));
    reviewBox.style.border.fg = 'magenta';
  }
  reviewBox.setLabel(` 👁 In Review (${inReview.length}) `);

  // Completed
  if (completed.length === 0) {
    completedBox.setItems(['{gray-fg}None today{/gray-fg}']);
  } else {
    completedBox.setItems(completed.map(t =>
      `{green-fg}✓{/green-fg} ${t.name}`
    ));
  }
  completedBox.setLabel(` ✓ Completed (${completed.length}) `);

  // ─────────────────────────────────────────────────────────────
  // Activity Log (for view date)
  // ─────────────────────────────────────────────────────────────
  activityLog.logLines = [];

  // Add review activity for view date
  const viewDateReviews = pendingReviews.filter(r =>
    r.createdAt && r.createdAt.startsWith(viewDateStr)
  );
  for (const review of viewDateReviews.slice(0, 3)) {
    const time = new Date(review.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    activityLog.log(`{magenta-fg}◆{/magenta-fg} ${time} Review: ${review.title?.substring(0, 30)}`);
  }

  // Add task history for view date
  for (const entry of viewDayHistory.slice(0, 8)) {
    const icon = entry.success ? '{green-fg}✓{/green-fg}' : '{red-fg}✗{/red-fg}';
    const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    activityLog.log(`${icon} ${time} ${entry.task}`);
  }

  if (viewDayHistory.length === 0 && viewDateReviews.length === 0) {
    if (dayOffset > 0) {
      activityLog.log(`{gray-fg}No activity yet (future date){/gray-fg}`);
    } else if (dayOffset === 0) {
      activityLog.log(`{gray-fg}No activity today yet{/gray-fg}`);
    } else {
      activityLog.log(`{gray-fg}No activity on this date{/gray-fg}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Stats (for view date)
  // ─────────────────────────────────────────────────────────────
  const viewDaySuccess = viewDayHistory.filter(h => h.success).length;
  const viewDayFailed = viewDayHistory.filter(h => !h.success).length;
  const totalPendingReviews = pendingReviews.length;
  const viewDayCompletedReviews = (reviews.completed || []).filter(r =>
    r.approvedAt && r.approvedAt.startsWith(viewDateStr)
  ).length;

  const dayLabel2 = dayOffset === 0 ? 'Today' : viewDate.toLocaleDateString('en-US', { weekday: 'short' });

  const statsContent = [
    '',
    `{bold}${dayLabel2}:{/bold}`,
    `  {green-fg}${viewDaySuccess}{/green-fg} completed`,
    `  {red-fg}${viewDayFailed}{/red-fg} failed`,
    '',
    `{bold}Reviews:{/bold}`,
    `  {magenta-fg}${totalPendingReviews}{/magenta-fg} pending`,
    `  ${viewDayCompletedReviews} approved`,
    ''
  ].join('\n');

  statsBox.setContent(statsContent);

  // ─────────────────────────────────────────────────────────────
  // Header
  // ─────────────────────────────────────────────────────────────
  const nextTask = scheduled.sort((a, b) => a.hour - b.hour)[0];
  const nextStr = nextTask ? `Next: ${nextTask.name} @ ${nextTask.status.replace('@ ', '')}` : (isViewDayWeekday ? 'Tasks completed' : 'Weekend');

  const viewDayName = viewDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const viewingLabel = dayOffset === 0 ? '' : ` {yellow-fg}(viewing ${dayOffset > 0 ? '+' : ''}${dayOffset}d){/yellow-fg}`;

  header.setContent(
    `{center}{bold}CONTENT AUTOMATION HUB{/bold}  |  ${viewDayName}${viewingLabel}  |  ${nextStr}{/center}`
  );

  screen.render();
}

// ═══════════════════════════════════════════════════════════════
// KEY BINDINGS
// ═══════════════════════════════════════════════════════════════

screen.key(['escape', 'q', 'C-c'], () => process.exit(0));

screen.key(['r'], () => {
  activityLog.log('{cyan-fg}Refreshing...{/cyan-fg}');
  refreshDashboard();
});

screen.key(['g'], () => {
  activityLog.log('{yellow-fg}To generate: npm run generate-blog{/yellow-fg}');
  screen.render();
});

screen.key(['v'], () => {
  activityLog.log('{magenta-fg}To view reviews: npm run reviews{/magenta-fg}');
  screen.render();
});

// Day navigation
screen.key(['right', 'l'], () => {
  dayOffset++;
  if (dayOffset > 7) dayOffset = 7; // Max 1 week ahead
  refreshDashboard();
});

screen.key(['left', 'h'], () => {
  dayOffset--;
  if (dayOffset < -7) dayOffset = -7; // Max 1 week back
  refreshDashboard();
});

screen.key(['t', '0'], () => {
  dayOffset = 0; // Jump to today
  refreshDashboard();
});

// ═══════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════

// Initial render
refreshDashboard();

// Refresh every 2 seconds
setInterval(() => {
  runningIndicator++;
  refreshDashboard();
}, 2000);

screen.render();
