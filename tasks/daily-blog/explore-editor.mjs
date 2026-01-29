#!/usr/bin/env node
/**
 * Interactive exploration of the ArcBlock blog editor
 * Run with: node tasks/daily-blog/explore-editor.mjs
 */

import { chromium } from 'playwright';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync } from 'node:fs';

const PROFILE_PATH = join(homedir(), 'Library', 'Application Support', 'ArcBlock-Automation', 'Chrome');
const SCREENSHOTS_DIR = join(homedir(), 'content-automation', 'data', 'blog-drafts');

async function exploreEditor() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ArcBlock Blog Editor Explorer');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Opening browser in VISIBLE mode...\n');

  const context = await chromium.launchPersistentContext(PROFILE_PATH, {
    headless: false,  // VISIBLE browser
    viewport: { width: 1400, height: 900 },
    slowMo: 500  // Slow down actions so you can see them
  });

  const page = context.pages()[0] || await context.newPage();

  console.log('Navigating to blog editor...\n');
  await page.goto('https://www.arcblock.io/blog/blog/new', {
    waitUntil: 'networkidle'
  });

  console.log('Taking screenshot of initial state...');
  await page.screenshot({ 
    path: join(SCREENSHOTS_DIR, 'explore-1-initial.png'),
    fullPage: true 
  });

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  INSTRUCTIONS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  The browser is now open. Please:');
  console.log('');
  console.log('  1. Look for where to enter the TITLE');
  console.log('  2. Look for where to set the URL SLUG');
  console.log('  3. Look for where to add TAGS');
  console.log('  4. Look for the SETTINGS/METADATA panel');
  console.log('');
  console.log('  If there\'s a settings icon, click it now to open the panel.');
  console.log('');
  console.log('  Press ENTER when you\'ve found the settings...');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Wait for user input
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });

  console.log('Taking screenshot after you opened settings...');
  await page.screenshot({ 
    path: join(SCREENSHOTS_DIR, 'explore-2-settings-open.png'),
    fullPage: true 
  });

  // Get all input fields on the page
  console.log('\nScanning for input fields...\n');

  const inputs = await page.$$eval('input, textarea', elements => {
    return elements.map(el => ({
      tag: el.tagName,
      type: el.type || 'text',
      name: el.name || '',
      placeholder: el.placeholder || '',
      id: el.id || '',
      className: el.className || '',
      visible: el.offsetParent !== null
    })).filter(el => el.visible);
  });

  console.log('Found input fields:');
  console.log('─────────────────────────────────────────────────────────────────');
  inputs.forEach((input, i) => {
    console.log(`${i + 1}. <${input.tag.toLowerCase()}>`);
    console.log(`   type: ${input.type}`);
    console.log(`   name: "${input.name}"`);
    console.log(`   placeholder: "${input.placeholder}"`);
    console.log(`   id: "${input.id}"`);
    console.log(`   class: "${input.className.substring(0, 50)}..."`);
    console.log('');
  });

  // Get all buttons
  const buttons = await page.$$eval('button', elements => {
    return elements.map(el => ({
      text: el.innerText?.trim().substring(0, 30) || '',
      className: el.className || '',
      disabled: el.disabled,
      visible: el.offsetParent !== null
    })).filter(el => el.visible && el.text);
  });

  console.log('\nFound buttons:');
  console.log('─────────────────────────────────────────────────────────────────');
  buttons.forEach((btn, i) => {
    const status = btn.disabled ? '(disabled)' : '(enabled)';
    console.log(`${i + 1}. "${btn.text}" ${status}`);
  });

  // Save the field info to a file
  const fieldInfo = { inputs, buttons, timestamp: new Date().toISOString() };
  writeFileSync(
    join(SCREENSHOTS_DIR, 'editor-fields.json'),
    JSON.stringify(fieldInfo, null, 2)
  );
  console.log('\nSaved field info to: data/blog-drafts/editor-fields.json');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Screenshots saved to data/blog-drafts/');
  console.log('  - explore-1-initial.png');
  console.log('  - explore-2-settings-open.png');
  console.log('');
  console.log('  Close the browser when done exploring.');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Wait for browser to close
  await new Promise(resolve => {
    context.on('close', resolve);
  });

  console.log('Browser closed. Exploration complete!\n');
}

exploreEditor().catch(console.error);
