#!/usr/bin/env node
/**
 * CLI for Content Automation Hub
 */

import { loadState, getHistory } from './shared/state.mjs';
import { discoverTasks, loadTaskRegistry } from './shared/task-loader.mjs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const command = process.argv[2];
const args = process.argv.slice(3);

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function formatDate(isoString) {
  if (!isoString) return 'Never';
  const d = new Date(isoString);
  return d.toLocaleString();
}

function printStatus() {
  console.log(`\n${COLORS.bright}═══════════════════════════════════════════════════════════════${COLORS.reset}`);
  console.log(`${COLORS.bright}                  CONTENT AUTOMATION HUB STATUS${COLORS.reset}`);
  console.log(`${COLORS.bright}═══════════════════════════════════════════════════════════════${COLORS.reset}\n`);

  const state = loadState();
  const registry = loadTaskRegistry();
  const tasks = discoverTasks();

  // Global stats
  console.log(`${COLORS.cyan}Global Statistics:${COLORS.reset}`);
  console.log(`  Total Runs: ${state.global?.totalRuns || 0}`);
  console.log(`  Successes:  ${COLORS.green}${state.global?.totalSuccess || 0}${COLORS.reset}`);
  console.log(`  Failures:   ${COLORS.red}${state.global?.totalFailure || 0}${COLORS.reset}`);
  console.log(`  Last Run:   ${formatDate(state.lastRun)}`);
  console.log();

  // Task status
  console.log(`${COLORS.cyan}Task Status:${COLORS.reset}`);
  console.log(`${'─'.repeat(65)}`);
  console.log(`  ${'Task'.padEnd(18)} ${'Status'.padEnd(10)} ${'Today'.padEnd(8)} ${'Last Run'.padEnd(20)} Retries`);
  console.log(`${'─'.repeat(65)}`);

  for (const task of tasks) {
    const regEntry = registry[task.name] || {};
    const taskState = state.tasks?.[task.name] || {};
    const enabled = regEntry.enabled !== false;

    const statusIcon = enabled ? `${COLORS.green}●${COLORS.reset}` : `${COLORS.gray}○${COLORS.reset}`;
    const statusText = enabled ? 'Enabled' : 'Disabled';
    const todayCount = `${taskState.todayCount || 0}/${regEntry.dailyLimit || task.config?.dailyLimit || '∞'}`;
    const lastRun = taskState.lastRun ? new Date(taskState.lastRun).toLocaleTimeString() : 'Never';
    const retries = taskState.retryCount || 0;
    const retryColor = retries > 0 ? COLORS.yellow : COLORS.reset;

    console.log(`  ${statusIcon} ${task.name.padEnd(16)} ${statusText.padEnd(10)} ${todayCount.padEnd(8)} ${lastRun.padEnd(20)} ${retryColor}${retries}${COLORS.reset}`);
  }
  console.log(`${'─'.repeat(65)}\n`);

  // Recent history
  const history = getHistory(10);
  if (history.length > 0) {
    console.log(`${COLORS.cyan}Recent Activity:${COLORS.reset}`);
    for (const entry of history) {
      const icon = entry.success ? `${COLORS.green}✓${COLORS.reset}` : `${COLORS.red}✗${COLORS.reset}`;
      const time = new Date(entry.timestamp).toLocaleString();
      console.log(`  ${icon} ${entry.task.padEnd(16)} ${time}`);
    }
    console.log();
  }
}

function listTasks() {
  console.log(`\n${COLORS.bright}Available Tasks:${COLORS.reset}\n`);

  const tasks = discoverTasks();
  const registry = loadTaskRegistry();

  for (const task of tasks) {
    const regEntry = registry[task.name] || {};
    const enabled = regEntry.enabled !== false;
    const icon = enabled ? `${COLORS.green}●${COLORS.reset}` : `${COLORS.gray}○${COLORS.reset}`;

    console.log(`${icon} ${COLORS.bright}${task.name}${COLORS.reset}`);
    console.log(`    ${task.config?.description || 'No description'}`);
    console.log(`    Category: ${task.config?.category || regEntry.category || 'uncategorized'}`);
    console.log(`    Schedule: ${regEntry.schedule || task.config?.schedule || 'manual'}`);
    console.log();
  }
}

async function runTask(taskName) {
  if (!taskName) {
    console.error(`${COLORS.red}Error: Task name required${COLORS.reset}`);
    console.log('Usage: npm run run-task <task-name>');
    process.exit(1);
  }

  console.log(`\n${COLORS.cyan}Running task: ${taskName}${COLORS.reset}\n`);

  const child = spawn('node', [join(__dirname, 'index.mjs'), '--task', taskName], {
    stdio: 'inherit',
    cwd: join(__dirname, '..')
  });

  child.on('close', (code) => {
    process.exit(code);
  });
}

function showHelp() {
  console.log(`
${COLORS.bright}Content Automation Hub CLI${COLORS.reset}

${COLORS.cyan}Commands:${COLORS.reset}
  npm run status       Show hub status and recent activity
  npm run list-tasks   List all available tasks
  npm run run-task X   Run a specific task
  npm start            Run all enabled tasks

${COLORS.cyan}Files for Claude Code:${COLORS.reset}
  README.md                     Full documentation
  tasks/_template/              Template for new tasks
  config/tasks.yaml             Task registry

${COLORS.cyan}To add a new task, tell Claude Code:${COLORS.reset}
  "Read ~/content-automation/README.md and add a new task for [description]"
`);
}

// Route commands
switch (command) {
  case 'status':
    printStatus();
    break;
  case 'list':
    listTasks();
    break;
  case 'run':
    runTask(args[0]);
    break;
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  default:
    showHelp();
}
