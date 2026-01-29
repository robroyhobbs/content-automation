#!/usr/bin/env node
/**
 * Explore tabs in the blog editor to find settings
 */

import { chromium } from 'playwright';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROFILE_PATH = join(homedir(), 'Library', 'Application Support', 'ArcBlock-Automation', 'Chrome');
const OUTPUT_DIR = join(homedir(), 'content-automation', 'data', 'blog-drafts');

async function exploreTabs() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Exploring Editor Tabs');
  console.log('═══════════════════════════════════════════════════════════════\n');

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

    await page.waitForTimeout(2000);

    // Get all tab buttons (at position y ~152)
    const tabs = await page.$$('.MuiTab-root');
    console.log(`Found ${tabs.length} tabs\n`);

    // Click each tab and take a screenshot
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];

      // Get tab info before clicking
      const tabInfo = await tab.evaluate(el => ({
        ariaLabel: el.getAttribute('aria-label'),
        ariaSelected: el.getAttribute('aria-selected'),
        title: el.getAttribute('title'),
        innerHTML: el.innerHTML.substring(0, 100)
      }));

      console.log(`Tab ${i + 1}:`);
      console.log(`  aria-label: ${tabInfo.ariaLabel}`);
      console.log(`  selected: ${tabInfo.ariaSelected}`);
      console.log('');

      // Click the tab
      await tab.click();
      await page.waitForTimeout(1000);

      // Take screenshot
      await page.screenshot({
        path: join(OUTPUT_DIR, `tab-${i + 1}.png`),
        fullPage: true
      });
      console.log(`  Screenshot saved: tab-${i + 1}.png\n`);
    }

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Check tab-1.png through tab-5.png to see each view');
    console.log('═══════════════════════════════════════════════════════════════\n');

  } finally {
    await context.close();
  }
}

exploreTabs().catch(console.error);
