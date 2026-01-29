#!/usr/bin/env node
/**
 * Find settings panel and additional required fields
 */

import { chromium } from 'playwright';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROFILE_PATH = join(homedir(), 'Library', 'Application Support', 'ArcBlock-Automation', 'Chrome');
const OUTPUT_DIR = join(homedir(), 'content-automation', 'data', 'blog-drafts');

async function findSettings() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Finding Settings Panel');
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

    // Look for settings icons, gear icons, or sidebar toggles
    const settingsButtons = await page.evaluate(() => {
      const results = [];

      // Look for buttons with settings-related keywords in class or aria-label
      document.querySelectorAll('button, [role="button"], svg').forEach((el, i) => {
        const className = el.className?.toString() || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        const id = el.id || '';
        const text = el.innerText?.trim() || '';

        // Check for settings-related patterns
        const isSettings =
          className.includes('setting') ||
          className.includes('gear') ||
          className.includes('config') ||
          className.includes('option') ||
          className.includes('sidebar') ||
          className.includes('panel') ||
          className.includes('meta') ||
          ariaLabel.toLowerCase().includes('setting') ||
          ariaLabel.toLowerCase().includes('option') ||
          title.toLowerCase().includes('setting') ||
          text.toLowerCase().includes('setting');

        if (el.tagName === 'BUTTON') {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            results.push({
              tag: el.tagName,
              index: i,
              text: text.substring(0, 30),
              className: className.substring(0, 80),
              ariaLabel,
              title,
              isSettings,
              position: { x: Math.round(rect.left), y: Math.round(rect.top) }
            });
          }
        }
      });

      return results;
    });

    console.log('All buttons found:');
    console.log('─────────────────────────────────────────────────────────────────\n');

    settingsButtons.forEach((btn, i) => {
      const marker = btn.isSettings ? '*** ' : '    ';
      console.log(`${marker}${i + 1}. "${btn.text || '(no text)'}" @ (${btn.position.x}, ${btn.position.y})`);
      console.log(`       class: ${btn.className}`);
      if (btn.ariaLabel) console.log(`       aria-label: ${btn.ariaLabel}`);
      console.log('');
    });

    // Look for any sidebars or panels that might be hidden
    const sidebars = await page.evaluate(() => {
      const panels = [];
      document.querySelectorAll('[class*="sidebar"], [class*="panel"], [class*="drawer"], [class*="settings"], aside, [role="complementary"]').forEach(el => {
        const rect = el.getBoundingClientRect();
        panels.push({
          tag: el.tagName,
          className: el.className?.substring(0, 80),
          visible: rect.width > 0 && rect.height > 0,
          position: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) }
        });
      });
      return panels;
    });

    console.log('\nPotential sidebar/panel elements:');
    console.log('─────────────────────────────────────────────────────────────────\n');

    sidebars.forEach((panel, i) => {
      console.log(`${i + 1}. <${panel.tag.toLowerCase()}> visible=${panel.visible}`);
      console.log(`   class: ${panel.className}`);
      console.log(`   position: x=${panel.position.x}, y=${panel.position.y}, w=${panel.position.w}, h=${panel.position.h}`);
      console.log('');
    });

    // Check what tabs exist (we saw some tabs in the inspection earlier)
    const tabs = await page.evaluate(() => {
      const tabList = [];
      document.querySelectorAll('[role="tab"], .MuiTab-root, [class*="tab"]').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          tabList.push({
            tag: el.tagName,
            text: el.innerText?.trim() || '',
            className: el.className?.substring(0, 60),
            selected: el.classList.contains('Mui-selected') || el.getAttribute('aria-selected') === 'true',
            position: { x: Math.round(rect.left), y: Math.round(rect.top) }
          });
        }
      });
      return tabList;
    });

    console.log('\nTabs found:');
    console.log('─────────────────────────────────────────────────────────────────\n');

    tabs.forEach((tab, i) => {
      const marker = tab.selected ? '→ ' : '  ';
      console.log(`${marker}${i + 1}. "${tab.text}" ${tab.selected ? '(SELECTED)' : ''}`);
      console.log(`     class: ${tab.className}`);
      console.log('');
    });

    // Take screenshot
    await page.screenshot({ path: join(OUTPUT_DIR, 'find-settings.png'), fullPage: true });
    console.log('Screenshot saved: find-settings.png\n');

  } finally {
    await context.close();
  }
}

findSettings().catch(console.error);
