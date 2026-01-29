#!/usr/bin/env node
/**
 * Discover what's required to enable the publish button
 */

import { chromium } from 'playwright';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROFILE_PATH = join(homedir(), 'Library', 'Application Support', 'ArcBlock-Automation', 'Chrome');
const OUTPUT_DIR = join(homedir(), 'content-automation', 'data', 'blog-drafts');

async function discoverRequirements() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Discovering Publish Button Requirements');
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

    // ═══════════════════════════════════════════════════════════════
    // 1. Explore the tabs at the top
    // ═══════════════════════════════════════════════════════════════
    console.log('1. EXPLORING TABS\n');

    const tabs = await page.$$('.MuiTab-root');
    console.log(`   Found ${tabs.length} tabs\n`);

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const isSelected = await tab.evaluate(el => el.classList.contains('Mui-selected'));
      const ariaLabel = await tab.getAttribute('aria-label');

      // Get any icon or text inside
      const innerHTML = await tab.evaluate(el => el.innerHTML.substring(0, 200));

      console.log(`   Tab ${i + 1}: ${isSelected ? '(SELECTED)' : ''}`);
      console.log(`      aria-label: ${ariaLabel || '(none)'}`);

      // Look for SVG icons that might indicate the tab type
      const hasSvg = innerHTML.includes('<svg');
      if (hasSvg) {
        // Try to identify the icon type from path data
        const pathMatch = innerHTML.match(/d="([^"]{0,50})/);
        if (pathMatch) {
          console.log(`      icon hint: ${pathMatch[1].substring(0, 30)}...`);
        }
      }
      console.log('');
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. Look for any validation messages or required field indicators
    // ═══════════════════════════════════════════════════════════════
    console.log('2. LOOKING FOR REQUIRED FIELDS\n');

    const requiredIndicators = await page.evaluate(() => {
      const indicators = [];

      // Look for asterisks, "required", error states
      document.querySelectorAll('*').forEach(el => {
        const text = el.innerText?.trim() || '';
        const className = el.className?.toString?.() || '';

        if (
          text === '*' ||
          text.toLowerCase().includes('required') ||
          className.includes('error') ||
          className.includes('required') ||
          el.getAttribute('aria-required') === 'true' ||
          el.hasAttribute('required')
        ) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.top < 1000) {
            indicators.push({
              tag: el.tagName,
              text: text.substring(0, 50),
              className: className.substring(0, 60),
              position: { x: Math.round(rect.left), y: Math.round(rect.top) }
            });
          }
        }
      });

      return indicators;
    });

    if (requiredIndicators.length > 0) {
      requiredIndicators.forEach((ind, i) => {
        console.log(`   ${i + 1}. <${ind.tag.toLowerCase()}> "${ind.text}" @ (${ind.position.x}, ${ind.position.y})`);
        console.log(`      class: ${ind.className}`);
      });
    } else {
      console.log('   No explicit required field indicators found');
    }
    console.log('');

    // ═══════════════════════════════════════════════════════════════
    // 3. Check the publish button's disabled state reason
    // ═══════════════════════════════════════════════════════════════
    console.log('3. ANALYZING PUBLISH BUTTON\n');

    const publishButtonInfo = await page.evaluate(() => {
      const btn = document.querySelector('button.publish-button') ||
                  document.querySelector('button:has-text("Publish")');
      if (!btn) return null;

      return {
        disabled: btn.disabled,
        className: btn.className,
        ariaDisabled: btn.getAttribute('aria-disabled'),
        title: btn.title,
        // Check for tooltip or helper text nearby
        nextSibling: btn.nextElementSibling?.innerText?.substring(0, 100),
        parentClass: btn.parentElement?.className
      };
    });

    if (publishButtonInfo) {
      console.log(`   disabled: ${publishButtonInfo.disabled}`);
      console.log(`   aria-disabled: ${publishButtonInfo.ariaDisabled}`);
      console.log(`   class: ${publishButtonInfo.className.substring(0, 80)}`);
      if (publishButtonInfo.title) console.log(`   title: ${publishButtonInfo.title}`);
    }
    console.log('');

    // ═══════════════════════════════════════════════════════════════
    // 4. Check what inputs/fields exist on the page
    // ═══════════════════════════════════════════════════════════════
    console.log('4. ALL INPUT FIELDS ON PAGE\n');

    const allInputs = await page.evaluate(() => {
      const inputs = [];
      document.querySelectorAll('input, textarea, select, [contenteditable="true"]').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          inputs.push({
            tag: el.tagName,
            type: el.type || 'contenteditable',
            name: el.name,
            placeholder: el.placeholder || el.getAttribute('data-placeholder'),
            value: el.value?.substring(0, 30) || el.innerText?.substring(0, 30),
            required: el.required || el.getAttribute('aria-required') === 'true',
            position: { x: Math.round(rect.left), y: Math.round(rect.top) },
            className: (el.className?.toString?.() || '').substring(0, 50)
          });
        }
      });
      return inputs;
    });

    allInputs.forEach((input, i) => {
      const marker = input.required ? '* ' : '  ';
      console.log(`${marker}${i + 1}. <${input.tag.toLowerCase()}> type="${input.type}"`);
      if (input.placeholder) console.log(`      placeholder: "${input.placeholder}"`);
      if (input.name) console.log(`      name: "${input.name}"`);
      if (input.value) console.log(`      value: "${input.value}"`);
      console.log(`      @ (${input.position.x}, ${input.position.y})`);
      console.log('');
    });

    // ═══════════════════════════════════════════════════════════════
    // 5. Try clicking each tab to see if it reveals required fields
    // ═══════════════════════════════════════════════════════════════
    console.log('5. EXPLORING EACH TAB\n');

    for (let i = 0; i < tabs.length; i++) {
      console.log(`   Clicking tab ${i + 1}...`);
      await tabs[i].click();
      await page.waitForTimeout(1000);

      // Check what new inputs appeared
      const newInputs = await page.evaluate(() => {
        const inputs = [];
        document.querySelectorAll('input, textarea, select').forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.top > 100) {
            inputs.push({
              tag: el.tagName,
              type: el.type,
              placeholder: el.placeholder,
              name: el.name,
              required: el.required,
              y: Math.round(rect.top)
            });
          }
        });
        return inputs;
      });

      if (newInputs.length > 0) {
        newInputs.forEach(inp => {
          const marker = inp.required ? '* ' : '  ';
          console.log(`   ${marker}<${inp.tag.toLowerCase()}> "${inp.placeholder || inp.name || inp.type}" @ y=${inp.y}`);
        });
      }
      console.log('');

      // Screenshot each tab
      await page.screenshot({
        path: join(OUTPUT_DIR, `discover-tab-${i + 1}.png`),
        fullPage: true
      });
    }

    console.log('\nScreenshots saved: discover-tab-1.png through discover-tab-5.png\n');

  } finally {
    await context.close();
  }
}

discoverRequirements().catch(console.error);
