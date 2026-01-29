#!/usr/bin/env node
/**
 * Test: Fill content, save draft, then check publish button
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROFILE_PATH = join(homedir(), 'Library', 'Application Support', 'ArcBlock-Automation', 'Chrome');
const OUTPUT_DIR = join(homedir(), 'content-automation', 'data', 'blog-drafts');

async function testSaveThenPublish() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Test: Save Draft Then Publish');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load a draft
  const draftPath = join(OUTPUT_DIR, '2026-01-29-why-arcblock-architecture-solves-did-problems.json');
  const blogData = JSON.parse(readFileSync(draftPath, 'utf-8'));
  console.log(`Loaded draft: "${blogData.title}"\n`);

  const context = await chromium.launchPersistentContext(PROFILE_PATH, {
    headless: true,
    viewport: { width: 1400, height: 900 }
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto('https://www.arcblock.io/blog/blog/new', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForTimeout(3000);

    // ═══════════════════════════════════════════════════════════════
    // Step 1: Fill Title
    // ═══════════════════════════════════════════════════════════════
    console.log('Step 1: Filling title...');
    const titleField = await page.$('textarea[placeholder="Enter title..."]');
    if (!titleField) throw new Error('Title field not found');

    await titleField.click();
    await page.waitForTimeout(200);
    await titleField.fill(blogData.title);
    await page.waitForTimeout(500);
    console.log('  Title filled\n');

    // ═══════════════════════════════════════════════════════════════
    // Step 2: Fill Content (use full content, not truncated)
    // ═══════════════════════════════════════════════════════════════
    console.log('Step 2: Filling content...');
    const contentEditor = await page.$('div.be-editable[contenteditable="true"]');
    if (!contentEditor) throw new Error('Content editor not found');

    await contentEditor.click();
    await page.waitForTimeout(300);

    // Use full content (without markdown # title since title is separate)
    let content = blogData.content;
    if (content.startsWith('#')) {
      content = content.replace(/^#[^\n]*\n+/, '');
    }

    await page.evaluate((text) => {
      const editor = document.querySelector('div.be-editable[contenteditable="true"]');
      if (editor) {
        editor.focus();
        editor.innerHTML = '';
        document.execCommand('insertText', false, text);
      }
    }, content);

    await page.waitForTimeout(1000);
    console.log(`  Content filled (${content.length} chars)\n`);

    // ═══════════════════════════════════════════════════════════════
    // Step 3: Check publish button state BEFORE saving
    // ═══════════════════════════════════════════════════════════════
    console.log('Step 3: Checking publish button BEFORE save...');
    let publishBtn = await page.$('button.publish-button');
    let isEnabled = publishBtn ? await publishBtn.isEnabled() : false;
    console.log(`  Publish button enabled: ${isEnabled}\n`);

    await page.screenshot({ path: join(OUTPUT_DIR, 'save-test-1-before-save.png'), fullPage: true });

    // ═══════════════════════════════════════════════════════════════
    // Step 4: Click Save Draft
    // ═══════════════════════════════════════════════════════════════
    console.log('Step 4: Clicking Save Draft...');
    const saveDraftBtn = await page.$('button:has-text("Save Draft")');
    if (!saveDraftBtn) throw new Error('Save Draft button not found');

    await saveDraftBtn.click();

    // Wait for save to complete (look for success indication)
    await page.waitForTimeout(3000);

    console.log('  Draft saved (waited 3s)\n');

    await page.screenshot({ path: join(OUTPUT_DIR, 'save-test-2-after-save.png'), fullPage: true });

    // ═══════════════════════════════════════════════════════════════
    // Step 5: Check publish button state AFTER saving
    // ═══════════════════════════════════════════════════════════════
    console.log('Step 5: Checking publish button AFTER save...');
    publishBtn = await page.$('button.publish-button');
    isEnabled = publishBtn ? await publishBtn.isEnabled() : false;
    console.log(`  Publish button enabled: ${isEnabled}\n`);

    // Also check the URL - it might have changed to include a draft ID
    const currentUrl = page.url();
    console.log(`  Current URL: ${currentUrl}\n`);

    // ═══════════════════════════════════════════════════════════════
    // Step 6: If still disabled, look for error messages or missing fields
    // ═══════════════════════════════════════════════════════════════
    if (!isEnabled) {
      console.log('Step 6: Looking for validation errors...');

      const errors = await page.evaluate(() => {
        const messages = [];

        // Look for error messages, warnings, or required indicators
        document.querySelectorAll('[class*="error"], [class*="warning"], [class*="required"], [class*="invalid"], .Mui-error').forEach(el => {
          const text = el.innerText?.trim();
          if (text && text.length < 200) {
            messages.push(text);
          }
        });

        // Also look for any tooltip or helper text
        document.querySelectorAll('[role="tooltip"], [class*="tooltip"], [class*="helper"]').forEach(el => {
          const text = el.innerText?.trim();
          if (text) {
            messages.push(`Helper: ${text}`);
          }
        });

        return messages;
      });

      if (errors.length > 0) {
        console.log('  Found messages:');
        errors.forEach(e => console.log(`    - ${e}`));
      } else {
        console.log('  No error messages found');
      }

      // Try hovering over the publish button to see tooltip
      console.log('\n  Hovering over Publish button...');
      await publishBtn.hover();
      await page.waitForTimeout(1000);

      const tooltip = await page.evaluate(() => {
        const tip = document.querySelector('[role="tooltip"]');
        return tip ? tip.innerText : null;
      });

      if (tooltip) {
        console.log(`  Tooltip: ${tooltip}`);
      }

      await page.screenshot({ path: join(OUTPUT_DIR, 'save-test-3-hover-publish.png'), fullPage: true });
    }

    // ═══════════════════════════════════════════════════════════════
    // Step 7: Try clicking publish anyway (it might show a dialog)
    // ═══════════════════════════════════════════════════════════════
    if (publishBtn) {
      console.log('\nStep 7: Attempting to click Publish button...');
      try {
        await publishBtn.click({ force: true });
        await page.waitForTimeout(2000);

        await page.screenshot({ path: join(OUTPUT_DIR, 'save-test-4-after-publish-click.png'), fullPage: true });

        // Check if a modal/dialog appeared
        const dialogs = await page.evaluate(() => {
          const modals = [];
          document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="dialog"], .MuiDialog-root').forEach(el => {
            modals.push({
              text: el.innerText?.substring(0, 500),
              hasInputs: el.querySelectorAll('input, select').length
            });
          });
          return modals;
        });

        if (dialogs.length > 0) {
          console.log('  Dialog appeared:');
          dialogs.forEach(d => {
            console.log(`    Text: ${d.text?.substring(0, 200)}...`);
            console.log(`    Has ${d.hasInputs} input fields`);
          });
        }
      } catch (e) {
        console.log(`  Click failed: ${e.message}`);
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  Test complete. Check screenshots in data/blog-drafts/');
    console.log('═══════════════════════════════════════════════════════════════\n');

  } finally {
    await context.close();
  }
}

testSaveThenPublish().catch(console.error);
