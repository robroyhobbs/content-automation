#!/usr/bin/env node
/**
 * Test filling blog fields WITHOUT publishing (dry run)
 * Run with: node tasks/daily-blog/test-fill-only.mjs
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROFILE_PATH = join(homedir(), 'Library', 'Application Support', 'ArcBlock-Automation', 'Chrome');
const OUTPUT_DIR = join(homedir(), 'content-automation', 'data', 'blog-drafts');

async function testFillOnly() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Blog Publisher Dry Run Test');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load existing draft
  const draftPath = join(OUTPUT_DIR, '2026-01-29-why-arcblock-architecture-solves-did-problems.json');
  const blogData = JSON.parse(readFileSync(draftPath, 'utf-8'));
  console.log(`Loaded draft: "${blogData.title}"\n`);

  // Use a shorter version of content for testing
  const shortContent = blogData.content.substring(0, 500) + '\n\n[Content truncated for testing...]';

  // Launch browser
  console.log('Launching browser (headless)...\n');
  const context = await chromium.launchPersistentContext(PROFILE_PATH, {
    headless: true,
    viewport: { width: 1400, height: 900 }
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // Navigate to editor
    console.log('Navigating to blog editor...');
    await page.goto('https://www.arcblock.io/blog/blog/new', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Check if logged in
    if (page.url().includes('/login') || page.url().includes('/auth')) {
      throw new Error('Not logged in');
    }

    await page.waitForTimeout(2000);

    // Screenshot before filling
    await page.screenshot({ path: join(OUTPUT_DIR, 'test-1-before-fill.png'), fullPage: true });
    console.log('Saved: test-1-before-fill.png\n');

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Fill Title
    // ═══════════════════════════════════════════════════════════════
    console.log('STEP 1: Finding title field...');
    const titleField = await page.$('textarea[placeholder="Enter title..."]');

    if (!titleField) {
      throw new Error('Could not find title field');
    }
    console.log('  Found title field (textarea)');

    console.log(`  Filling title: "${blogData.title}"`);
    await titleField.click();
    await page.waitForTimeout(200);
    await titleField.fill(blogData.title);
    await page.waitForTimeout(500);
    console.log('  Title filled!\n');

    // Screenshot after title
    await page.screenshot({ path: join(OUTPUT_DIR, 'test-2-after-title.png'), fullPage: true });
    console.log('Saved: test-2-after-title.png\n');

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Fill Content
    // ═══════════════════════════════════════════════════════════════
    console.log('STEP 2: Finding content editor...');
    const contentEditor = await page.$('div.be-editable[contenteditable="true"]');

    if (!contentEditor) {
      throw new Error('Could not find content editor');
    }
    console.log('  Found content editor (div.be-editable)');

    console.log('  Filling content...');
    await contentEditor.click();
    await page.waitForTimeout(300);

    // Use execCommand to insert text
    await page.evaluate((content) => {
      const editor = document.querySelector('div.be-editable[contenteditable="true"]');
      if (editor) {
        editor.focus();
        editor.innerHTML = '';
        document.execCommand('insertText', false, content);
      }
    }, shortContent);

    await page.waitForTimeout(500);
    console.log('  Content filled!\n');

    // Screenshot after content
    await page.screenshot({ path: join(OUTPUT_DIR, 'test-3-after-content.png'), fullPage: true });
    console.log('Saved: test-3-after-content.png\n');

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Check Publish Button State
    // ═══════════════════════════════════════════════════════════════
    console.log('STEP 3: Checking publish button state...');
    const publishButton = await page.$('button.publish-button');

    if (publishButton) {
      const isEnabled = await publishButton.isEnabled();
      const buttonText = await publishButton.innerText();
      console.log(`  Found publish button: "${buttonText}"`);
      console.log(`  Button enabled: ${isEnabled}`);

      if (isEnabled) {
        console.log('\n  SUCCESS! Publish button is ENABLED - automation should work!\n');
      } else {
        console.log('\n  WARNING: Publish button is still disabled.');
        console.log('  There may be additional required fields.\n');
      }
    } else {
      console.log('  Could not find publish button');
    }

    // Final screenshot
    await page.screenshot({ path: join(OUTPUT_DIR, 'test-4-final.png'), fullPage: true });
    console.log('Saved: test-4-final.png\n');

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  DRY RUN COMPLETE');
    console.log('  Check screenshots in data/blog-drafts/ to verify:');
    console.log('  - test-1-before-fill.png (empty editor)');
    console.log('  - test-2-after-title.png (title filled)');
    console.log('  - test-3-after-content.png (content filled)');
    console.log('  - test-4-final.png (final state)');
    console.log('═══════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error(`\nERROR: ${error.message}\n`);
    await page.screenshot({ path: join(OUTPUT_DIR, 'test-error.png'), fullPage: true });
    console.log('Error screenshot saved: test-error.png');
  } finally {
    await context.close();
  }
}

testFillOnly().catch(console.error);
