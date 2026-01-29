#!/usr/bin/env node
/**
 * Quick schedule view - shows upcoming tasks for the week
 *
 * Usage: npm run schedule
 */

import { discoverTasks, loadTaskRegistry } from './shared/task-loader.mjs';
import { loadState } from './shared/state.mjs';
import { getPendingReviews } from './shared/reviews.mjs';

function getScheduledHour(task) {
  const schedule = task.config?.schedule;
  if (!schedule) return null;
  const parts = schedule.split(' ');
  if (parts.length >= 2) {
    return parseInt(parts[1], 10);
  }
  return null;
}

function formatHour(hour) {
  if (hour === 0) return '12:00 AM';
  if (hour === 12) return '12:00 PM';
  if (hour < 12) return `${hour}:00 AM`;
  return `${hour - 12}:00 PM`;
}

function main() {
  const tasks = discoverTasks();
  const registry = loadTaskRegistry();
  const state = loadState();
  const pendingReviews = getPendingReviews();

  const now = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  WEEKLY SCHEDULE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get enabled tasks with schedules
  const scheduledTasks = tasks.filter(t => {
    const regEntry = registry[t.name] || {};
    return regEntry.enabled !== false && getScheduledHour(t) !== null;
  });

  if (scheduledTasks.length === 0) {
    console.log('  No scheduled tasks found.\n');
    return;
  }

  // Show next 7 days
  for (let d = 0; d < 7; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() + d);

    const dayOfWeek = date.getDay();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const dateStr = date.toISOString().split('T')[0];
    const dayName = dayNames[dayOfWeek];
    const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const isToday = d === 0;
    const marker = isToday ? ' ← TODAY' : '';
    const dimmed = !isWeekday;

    if (dimmed) {
      console.log(`  \x1b[90m${dayName} ${dateLabel}${marker}\x1b[0m`);
      console.log(`    \x1b[90m(Weekend - no scheduled tasks)\x1b[0m\n`);
    } else {
      console.log(`  ${dayName} ${dateLabel}${marker}`);

      for (const task of scheduledTasks) {
        const hour = getScheduledHour(task);
        const taskState = state.tasks?.[task.name] || {};
        const ranOnDay = taskState.lastSuccess && taskState.lastSuccess.startsWith(dateStr);

        let status = '○';
        let statusText = 'Scheduled';

        if (ranOnDay) {
          status = '✓';
          statusText = 'Completed';
        } else if (isToday && hour <= now.getHours()) {
          status = '○';
          statusText = 'Pending';
        }

        console.log(`    ${status} ${formatHour(hour)} - ${task.name} (${statusText})`);
      }
      console.log('');
    }
  }

  // Show pending reviews
  if (pendingReviews.length > 0) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  PENDING REVIEWS');
    console.log('═══════════════════════════════════════════════════════════════\n');

    for (const review of pendingReviews) {
      console.log(`  ● ${review.title || review.type}`);
      console.log(`    ID: ${review.id}`);
      console.log(`    Created: ${new Date(review.createdAt).toLocaleString()}`);
      console.log('');
    }

    console.log('  To approve: npm run reviews approve <id>\n');
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Commands:');
  console.log('    npm run dashboard    Interactive dashboard');
  console.log('    npm run reviews      Manage reviews');
  console.log('    npm run generate-blog  Manual generation');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main();
