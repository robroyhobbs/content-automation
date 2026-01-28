#!/usr/bin/env node
/**
 * Live Terminal Dashboard for Content Automation Hub
 */

import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { loadState, getHistory } from '../shared/state.mjs';
import { discoverTasks, loadTaskRegistry } from '../shared/task-loader.mjs';

// Create screen
const screen = blessed.screen({
  smartCSR: true,
  title: 'Content Automation Hub'
});

// Create grid layout
const grid = new contrib.grid({ rows: 12, cols: 12, screen });

// Header
const header = grid.set(0, 0, 1, 12, blessed.box, {
  content: '{center}{bold}CONTENT AUTOMATION HUB{/bold}{/center}',
  tags: true,
  style: {
    fg: 'white',
    bg: 'blue'
  }
});

// Task Status Table
const taskTable = grid.set(1, 0, 5, 8, contrib.table, {
  keys: true,
  fg: 'white',
  label: ' Task Status ',
  columnSpacing: 2,
  columnWidth: [16, 10, 14, 14, 8]
});

// Attention Required Box
const attentionBox = grid.set(1, 8, 5, 4, blessed.list, {
  label: ' ⚠ Attention Required ',
  tags: true,
  border: { type: 'line' },
  style: {
    fg: 'white',
    border: { fg: 'yellow' },
    selected: { bg: 'yellow', fg: 'black' }
  },
  keys: true,
  vi: true,
  mouse: true
});

// Recent Activity Log
const activityLog = grid.set(6, 0, 4, 8, contrib.log, {
  label: ' Recent Activity ',
  fg: 'green',
  tags: true
});

// Stats Box (replacing donut)
const statsBox = grid.set(6, 8, 4, 4, blessed.box, {
  label: ' Statistics ',
  tags: true,
  border: { type: 'line' },
  style: {
    fg: 'white',
    border: { fg: 'cyan' }
  },
  padding: { left: 1, right: 1 }
});

// Instructions Box
const instructionsBox = grid.set(10, 0, 2, 12, blessed.box, {
  content: ' {bold}Keys:{/bold} [q] Quit  [r] Refresh  [↑↓] Navigate attention items  [enter] View details ',
  tags: true,
  border: { type: 'line' },
  style: {
    fg: 'cyan',
    border: { fg: 'gray' }
  }
});

// Track attention items for interaction
let attentionItems = [];

function formatTimeAgo(isoString) {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function refreshDashboard() {
  const state = loadState();
  const registry = loadTaskRegistry();
  const tasks = discoverTasks();
  const history = getHistory(20);

  // Build task table data
  const tableData = [];
  attentionItems = [];

  let totalRemaining = 0;

  for (const task of tasks) {
    const regEntry = registry[task.name] || {};
    const taskState = state.tasks?.[task.name] || {};
    const enabled = regEntry.enabled !== false;

    const dailyLimit = regEntry.dailyLimit || task.config?.dailyLimit || 999;
    const todayCount = taskState.todayCount || 0;
    const remaining = Math.max(0, dailyLimit - todayCount);

    if (enabled) totalRemaining += remaining;

    const status = !enabled ? 'Disabled' :
                   taskState.currentRun ? 'Running' :
                   taskState.retryCount >= 2 ? 'BLOCKED' :
                   remaining === 0 ? 'Done' : 'Ready';

    tableData.push([
      task.name,
      status,
      `${todayCount}/${dailyLimit}`,
      formatTimeAgo(taskState.lastRun),
      String(taskState.retryCount || 0)
    ]);

    // Check for attention items
    if (taskState.retryCount >= 2) {
      attentionItems.push({
        task: task.name,
        issue: 'Max retries exceeded',
        error: taskState.lastError,
        type: 'blocked'
      });
    } else if (taskState.lastError && taskState.retryCount > 0) {
      attentionItems.push({
        task: task.name,
        issue: `Failed (retry ${taskState.retryCount}/2)`,
        error: taskState.lastError,
        type: 'warning'
      });
    }
  }

  // Update task table
  taskTable.setData({
    headers: ['Task', 'Status', 'Today', 'Last Run', 'Retry'],
    data: tableData
  });

  // Update attention box
  if (attentionItems.length === 0) {
    attentionBox.setItems(['{green-fg}✓ All tasks healthy{/green-fg}']);
    attentionBox.style.border.fg = 'green';
    attentionBox.setLabel(' ✓ All Good ');
  } else {
    const items = attentionItems.map(item => {
      const color = item.type === 'blocked' ? 'red' : 'yellow';
      return `{${color}-fg}● ${item.task}{/${color}-fg}`;
    });
    attentionBox.setItems(items);
    attentionBox.style.border.fg = 'yellow';
    attentionBox.setLabel(` ⚠ ${attentionItems.length} Need Attention `);
  }

  // Update activity log
  activityLog.logLines = []; // Clear
  for (const entry of history.slice(0, 15)) {
    const icon = entry.success ? '{green-fg}✓{/green-fg}' : '{red-fg}✗{/red-fg}';
    const time = new Date(entry.timestamp).toLocaleTimeString();
    activityLog.log(`${icon} ${time} ${entry.task}`);
  }

  // Update stats box
  const totalSuccess = state.global?.totalSuccess || 0;
  const totalFailure = state.global?.totalFailure || 0;
  const total = totalSuccess + totalFailure;
  const successRate = total > 0 ? Math.round((totalSuccess / total) * 100) : 0;

  const statsContent = [
    '',
    `{bold}Today Remaining:{/bold}`,
    `  ${totalRemaining} tasks`,
    '',
    `{bold}All Time:{/bold}`,
    `  {green-fg}${totalSuccess}{/green-fg} success`,
    `  {red-fg}${totalFailure}{/red-fg} failed`,
    '',
    `{bold}Success Rate:{/bold}`,
    `  ${successRate}%`
  ].join('\n');

  statsBox.setContent(statsContent);

  // Update header with time
  const nextRun = '9:00 AM'; // TODO: Calculate from schedules
  header.setContent(`{center}{bold}CONTENT AUTOMATION HUB{/bold} | ${new Date().toLocaleString()} | Next: ${nextRun}{/center}`);

  screen.render();
}

// Handle attention item selection
attentionBox.on('select', (item, index) => {
  if (attentionItems[index]) {
    const attn = attentionItems[index];

    const popup = blessed.box({
      parent: screen,
      border: 'line',
      height: 12,
      width: 50,
      top: 'center',
      left: 'center',
      label: ` ${attn.task} `,
      tags: true,
      padding: 1,
      style: {
        border: { fg: attn.type === 'blocked' ? 'red' : 'yellow' }
      }
    });

    const content = [
      `{bold}Issue:{/bold} ${attn.issue}`,
      '',
      `{bold}Error:{/bold}`,
      `${(attn.error || 'None').substring(0, 100)}`,
      '',
      `{bold}To resolve:{/bold}`,
      attn.type === 'blocked'
        ? `Reset retries and re-run the task`
        : `Will auto-retry on next run`,
      '',
      '{gray-fg}Press any key to close{/gray-fg}'
    ].join('\n');

    popup.setContent(content);
    popup.focus();

    popup.key(['escape', 'enter', 'q'], () => {
      popup.destroy();
      attentionBox.focus();
      screen.render();
    });

    screen.render();
  }
});

// Key bindings
screen.key(['escape', 'q', 'C-c'], () => process.exit(0));
screen.key(['r'], () => {
  activityLog.log('{cyan-fg}Refreshing...{/cyan-fg}');
  refreshDashboard();
});

// Focus on attention box for navigation
attentionBox.focus();

// Initial render
refreshDashboard();

// Auto-refresh every 30 seconds
setInterval(refreshDashboard, 30000);

screen.render();
