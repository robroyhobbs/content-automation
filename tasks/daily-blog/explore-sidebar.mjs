#!/usr/bin/env node
/**
 * Explore the right sidebar/settings panel
 */

import { chromium } from 'playwright';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROFILE_PATH = join(homedir(), 'Library', 'Application Support', 'ArcBlock-Automation', 'Chrome');
const OUTPUT_DIR = join(homedir(), 'content-automation', 'data', 'blog-drafts');

async function exploreSidebar() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Exploring Sidebar/Settings Panel');
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

    await page.waitForTimeout(3000);

    // Screenshot initial state
    await page.screenshot({ path: join(OUTPUT_DIR, 'sidebar-1-initial.png'), fullPage: true });
    console.log('Saved: sidebar-1-initial.png\n');

    // Look for any clickable elements on the right side of the screen
    console.log('Looking for sidebar toggle buttons...\n');

    const rightSideElements = await page.evaluate(() => {
      const elements = [];
      const viewportWidth = window.innerWidth;

      document.querySelectorAll('button, [role="button"], [class*="toggle"], [class*="sidebar"], [class*="panel"]').forEach(el => {
        const rect = el.getBoundingClientRect();
        // Look for elements on the right side
        if (rect.left > viewportWidth * 0.6 && rect.width > 0 && rect.height > 0) {
          elements.push({
            tag: el.tagName,
            className: (el.className?.toString?.() || '').substring(0, 80),
            text: el.innerText?.trim().substring(0, 30),
            ariaLabel: el.getAttribute('aria-label'),
            position: { x: Math.round(rect.left), y: Math.round(rect.top) }
          });
        }
      });

      return elements;
    });

    console.log('Elements on right side of screen:');
    rightSideElements.forEach((el, i) => {
      console.log(`  ${i + 1}. <${el.tag.toLowerCase()}> "${el.text || el.ariaLabel || '(no text)'}" @ (${el.position.x}, ${el.position.y})`);
      console.log(`     class: ${el.className}`);
    });
    console.log('');

    // Try clicking on the right gray area to see if it opens a panel
    console.log('Clicking on the gray sidebar area (x=1000, y=400)...');
    await page.mouse.click(1000, 400);
    await page.waitForTimeout(1500);

    await page.screenshot({ path: join(OUTPUT_DIR, 'sidebar-2-after-click.png'), fullPage: true });
    console.log('Saved: sidebar-2-after-click.png\n');

    // Check if anything changed
    const newElements = await page.evaluate(() => {
      const inputs = [];
      document.querySelectorAll('input, textarea, select, [class*="select"], [class*="dropdown"]').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.left > 500) {
          inputs.push({
            tag: el.tagName,
            type: el.type,
            placeholder: el.placeholder,
            className: (el.className?.toString?.() || '').substring(0, 60),
            position: { x: Math.round(rect.left), y: Math.round(rect.top) }
          });
        }
      });
      return inputs;
    });

    if (newElements.length > 0) {
      console.log('New input fields found after clicking:');
      newElements.forEach((el, i) => {
        console.log(`  ${i + 1}. <${el.tag.toLowerCase()}> "${el.placeholder || el.type}" @ (${el.position.x}, ${el.position.y})`);
      });
    }
    console.log('');

    // Try looking for a hamburger menu or settings icon at the top
    console.log('Looking for menu/settings icons in header...\n');

    const headerButtons = await page.$$('button');
    for (let i = 0; i < Math.min(headerButtons.length, 10); i++) {
      const btn = headerButtons[i];
      const box = await btn.boundingBox();
      if (box && box.y < 60) {
        const text = await btn.innerText().catch(() => '');
        const ariaLabel = await btn.getAttribute('aria-label');
        console.log(`  Header button ${i + 1}: "${text || ariaLabel || '(icon)'}" @ (${Math.round(box.x)}, ${Math.round(box.y)})`);

        // Try clicking header buttons that aren't Save Draft or Publish
        if (!text.includes('Save') && !text.includes('Publish') && !text.includes('Draft')) {
          console.log(`    Clicking this button...`);
          await btn.click();
          await page.waitForTimeout(1500);

          await page.screenshot({ path: join(OUTPUT_DIR, `sidebar-3-after-header-btn-${i}.png`), fullPage: true });
          console.log(`    Saved: sidebar-3-after-header-btn-${i}.png\n`);

          // Check what appeared
          const panels = await page.evaluate(() => {
            const results = [];
            document.querySelectorAll('[class*="drawer"], [class*="modal"], [class*="dialog"], [class*="panel"], [class*="sidebar"]').forEach(el => {
              const rect = el.getBoundingClientRect();
              if (rect.width > 100 && rect.height > 100) {
                results.push({
                  className: (el.className?.toString?.() || '').substring(0, 60),
                  size: { w: Math.round(rect.width), h: Math.round(rect.height) },
                  hasInputs: el.querySelectorAll('input, select, textarea').length
                });
              }
            });
            return results;
          });

          if (panels.length > 0) {
            console.log('  Panels/drawers found:');
            panels.forEach(p => {
              console.log(`    - ${p.className} (${p.size.w}x${p.size.h}) with ${p.hasInputs} inputs`);
            });
          }
        }
      }
    }

    // Final comprehensive screenshot
    await page.screenshot({ path: join(OUTPUT_DIR, 'sidebar-final.png'), fullPage: true });
    console.log('\nSaved: sidebar-final.png\n');

  } finally {
    await context.close();
  }
}

exploreSidebar().catch(console.error);
