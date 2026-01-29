#!/usr/bin/env node
/**
 * One-time setup for blog automation
 * Run: npm run setup-blog-automation
 */

import { setupProfile, getAutomationProfilePath } from './blog-publisher.mjs';

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  ArcBlock Blog Automation Setup');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');
console.log('This script will open a browser window.');
console.log('');
console.log('Please log into your ArcBlock account and navigate to:');
console.log('  https://www.arcblock.io/blog/blog/new');
console.log('');
console.log('Close the browser window when you\'re logged in.');
console.log('');
console.log(`Profile will be saved to:`);
console.log(`  ${getAutomationProfilePath()}`);
console.log('');

const mockLogger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.log(`[WARN] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`)
};

try {
  await setupProfile(mockLogger);
  console.log('');
  console.log('✓ Setup complete!');
  console.log('');
  console.log('You can now run: npm run run-task daily-blog');
  console.log('');
} catch (error) {
  console.error('');
  console.error('✗ Setup failed:', error.message);
  console.error('');
  process.exit(1);
}
