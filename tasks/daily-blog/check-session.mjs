#!/usr/bin/env node
/**
 * Check if blog automation session is valid
 * Run: npm run check-blog-session
 */

import { isSessionValid, getAutomationProfilePath } from './blog-publisher.mjs';

console.log('');
console.log('Checking ArcBlock blog automation session...');
console.log('');

try {
  const valid = await isSessionValid();

  if (valid) {
    console.log('✓ Session is valid!');
    console.log(`  Profile: ${getAutomationProfilePath()}`);
    console.log('');
    console.log('You can now run: npm run run-task daily-blog');
  } else {
    console.log('✗ Session is invalid or not set up');
    console.log(`  Profile: ${getAutomationProfilePath()}`);
    console.log('');
    console.log('First-time setup:');
    console.log('  1. Run: npm run setup-blog-automation');
    console.log('  2. Log in manually when the browser opens');
    console.log('  3. Close the browser when done');
    console.log('  4. Run: npm run check-blog-session (to verify)');
  }
  console.log('');
} catch (error) {
  console.error('');
  console.error('✗ Check failed:', error.message);
  console.error('');
  process.exit(1);
}
