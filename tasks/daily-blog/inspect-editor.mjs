#!/usr/bin/env node
/**
 * Inspect the ArcBlock blog editor DOM to find correct selectors
 * Run with: node tasks/daily-blog/inspect-editor.mjs
 */

import { chromium } from 'playwright';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync } from 'node:fs';

const PROFILE_PATH = join(homedir(), 'Library', 'Application Support', 'ArcBlock-Automation', 'Chrome');
const OUTPUT_DIR = join(homedir(), 'content-automation', 'data', 'blog-drafts');

async function inspectEditor() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ArcBlock Blog Editor DOM Inspector');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const context = await chromium.launchPersistentContext(PROFILE_PATH, {
    headless: true,  // Run headless for inspection
    viewport: { width: 1400, height: 900 }
  });

  const page = context.pages()[0] || await context.newPage();

  console.log('Navigating to blog editor...\n');
  await page.goto('https://www.arcblock.io/blog/blog/new', {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  // Check if we're logged in
  const currentUrl = page.url();
  if (currentUrl.includes('/login') || currentUrl.includes('/auth')) {
    console.log('ERROR: Not logged in. Run setup first.');
    await context.close();
    process.exit(1);
  }

  // Wait for editor to load
  await page.waitForTimeout(2000);

  console.log('Inspecting DOM structure...\n');

  // Get detailed information about all editable elements
  const inspection = await page.evaluate(() => {
    const results = {
      contentEditables: [],
      inputs: [],
      placeholders: [],
      buttons: [],
      pageStructure: []
    };

    // Find all contenteditable elements
    document.querySelectorAll('[contenteditable="true"]').forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      results.contentEditables.push({
        index: i,
        tagName: el.tagName,
        className: el.className,
        id: el.id,
        placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '',
        innerText: el.innerText?.substring(0, 50) || '',
        position: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        isVisible: rect.height > 0 && rect.width > 0
      });
    });

    // Find all input/textarea elements
    document.querySelectorAll('input, textarea').forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      results.inputs.push({
        index: i,
        tagName: el.tagName,
        type: el.type,
        name: el.name,
        placeholder: el.placeholder,
        className: el.className,
        id: el.id,
        isVisible: rect.height > 0 && rect.width > 0
      });
    });

    // Find elements with placeholder-like text
    document.querySelectorAll('*').forEach(el => {
      const text = el.innerText?.trim();
      if (text && (text.includes('Enter title') || text.includes('title') || text.includes('Title'))) {
        if (el.children.length === 0 || el.tagName === 'SPAN' || el.tagName === 'DIV') {
          const rect = el.getBoundingClientRect();
          if (rect.height > 0 && rect.width > 0) {
            results.placeholders.push({
              tagName: el.tagName,
              className: el.className,
              text: text.substring(0, 100),
              position: { top: rect.top, left: rect.left },
              parentTag: el.parentElement?.tagName,
              parentClass: el.parentElement?.className
            });
          }
        }
      }
    });

    // Find all buttons
    document.querySelectorAll('button').forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (rect.height > 0 && rect.width > 0) {
        results.buttons.push({
          index: i,
          text: el.innerText?.trim().substring(0, 30),
          className: el.className,
          disabled: el.disabled,
          position: { top: rect.top, left: rect.left }
        });
      }
    });

    // Get basic page structure (main sections)
    const main = document.querySelector('main') || document.body;
    const children = main.children;
    for (let i = 0; i < Math.min(children.length, 10); i++) {
      const child = children[i];
      const rect = child.getBoundingClientRect();
      results.pageStructure.push({
        index: i,
        tagName: child.tagName,
        className: child.className?.substring(0, 50),
        position: { top: rect.top, height: rect.height }
      });
    }

    return results;
  });

  // Output results
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CONTENTEDITABLE ELEMENTS (sorted by position)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  inspection.contentEditables
    .filter(e => e.isVisible)
    .sort((a, b) => a.position.top - b.position.top)
    .forEach((el, i) => {
      console.log(`${i + 1}. <${el.tagName.toLowerCase()}>`);
      console.log(`   Position: top=${Math.round(el.position.top)}px, left=${Math.round(el.position.left)}px`);
      console.log(`   Size: ${Math.round(el.position.width)}x${Math.round(el.position.height)}`);
      console.log(`   Class: "${el.className.substring(0, 60)}"`);
      console.log(`   ID: "${el.id}"`);
      console.log(`   Placeholder: "${el.placeholder}"`);
      console.log(`   Content preview: "${el.innerText}"`);
      console.log('');
    });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ELEMENTS WITH "TITLE" TEXT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  inspection.placeholders.forEach((el, i) => {
    console.log(`${i + 1}. <${el.tagName.toLowerCase()}>`);
    console.log(`   Text: "${el.text}"`);
    console.log(`   Class: "${el.className}"`);
    console.log(`   Parent: <${el.parentTag?.toLowerCase()}> class="${el.parentClass?.substring(0, 50)}"`);
    console.log(`   Position: top=${Math.round(el.position.top)}px`);
    console.log('');
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  BUTTONS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  inspection.buttons.forEach((btn, i) => {
    const status = btn.disabled ? '(DISABLED)' : '(enabled)';
    console.log(`${i + 1}. "${btn.text}" ${status}`);
    console.log(`   Position: top=${Math.round(btn.position.top)}px`);
    console.log('');
  });

  // Save full inspection to file
  writeFileSync(
    join(OUTPUT_DIR, 'editor-inspection.json'),
    JSON.stringify(inspection, null, 2)
  );
  console.log('Full inspection saved to: data/blog-drafts/editor-inspection.json\n');

  // Take a screenshot with element highlights
  await page.screenshot({
    path: join(OUTPUT_DIR, 'editor-inspected.png'),
    fullPage: true
  });
  console.log('Screenshot saved to: data/blog-drafts/editor-inspected.png\n');

  await context.close();
  console.log('Inspection complete!\n');
}

inspectEditor().catch(console.error);
