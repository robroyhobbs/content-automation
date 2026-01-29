#!/usr/bin/env node
/**
 * Test the blog publishing automation with existing draft
 * Run with: node tasks/daily-blog/test-publish.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { launchBrowser, publishBlogPost } from './blog-publisher.mjs';

// Simple logger
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`)
};

async function testPublish() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Blog Publisher Test');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load existing draft
  const draftPath = join(homedir(), 'content-automation', 'data', 'blog-drafts', '2026-01-29-why-arcblock-architecture-solves-did-problems.json');

  let blogData;
  try {
    blogData = JSON.parse(readFileSync(draftPath, 'utf-8'));
    logger.info(`Loaded draft: ${blogData.title}`);
  } catch (e) {
    logger.error(`Could not load draft from ${draftPath}: ${e.message}`);
    process.exit(1);
  }

  // Launch browser in visible mode for testing
  logger.info('Launching browser (visible mode for testing)...');

  const context = await launchBrowser(false); // headless=false to see what's happening

  try {
    // Try to publish
    logger.info('Starting publish process...\n');

    const result = await publishBlogPost(context, blogData, logger);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  RESULT');
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (result.success) {
      console.log('  SUCCESS!');
      console.log(`  URL: ${result.url}`);
    } else {
      console.log('  FAILED');
      console.log(`  Error: ${result.error}`);
      console.log(`  Page URL: ${result.pageUrl}`);
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  Check screenshots in data/blog-drafts/ for details');
    console.log('═══════════════════════════════════════════════════════════════\n');

  } finally {
    // Keep browser open for a moment to see the result
    await new Promise(resolve => setTimeout(resolve, 5000));
    await context.close();
  }
}

testPublish().catch(console.error);
