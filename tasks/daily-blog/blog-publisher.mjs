/**
 * Blog Publisher - Automates publishing drafts to arcblock.io/blog
 * Uses Playwright with persistent context to maintain login state
 */

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Persistent Chrome profile for automation
 * Located at: ~/Library/Application Support/ArcBlock-Automation/Chrome
 * This is a SEPARATE profile from your main Chrome to avoid conflicts
 */
export function getAutomationProfilePath() {
  return join(homedir(), 'Library', 'Application Support', 'ArcBlock-Automation', 'Chrome');
}

/**
 * Launch browser with persistent context
 * First run: Opens browser for manual login
 * Subsequent runs: Reuses stored session/cookies
 */
export async function launchBrowser(headless = true) {
  const profilePath = getAutomationProfilePath();

  const context = await chromium.launchPersistentContext(profilePath, {
    headless,
    // Uses bundled Chromium (no channel specified)
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    args: ['--disable-blink-features=AutomationControlled']
  });

  return context;
}

/**
 * Fill blog form and submit
 * Handles title, slug, content, tags, cover image
 */
export async function publishBlogPost(context, blogData, logger) {
  const page = context.pages()[0] || await context.newPage();
  
  try {
    // Navigate to blog editor
    logger.info('Navigating to blog editor...');
    await page.goto('https://www.arcblock.io/blog/blog/new', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Check if we're on a login page
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/auth')) {
      throw new Error('Not logged in. Run "npm run setup-blog-automation" first.');
    }

    // Wait for the editor to load
    await page.waitForTimeout(2000);

    logger.info('Filling blog form fields...');

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Fill the TITLE field
    // Based on DOM inspection: textarea[placeholder="Enter title..."]
    // ═══════════════════════════════════════════════════════════════

    logger.info('Looking for title field...');

    // The title field is a TEXTAREA with placeholder "Enter title..."
    const titleField = await page.$('textarea[placeholder="Enter title..."]');

    if (!titleField) {
      await page.screenshot({
        path: join(homedir(), 'content-automation', 'data', 'blog-drafts', 'no-title-field.png'),
        fullPage: true
      });
      throw new Error('Could not find title field (textarea with placeholder "Enter title..."). Check no-title-field.png');
    }

    // Fill the title
    logger.info(`Filling title: "${blogData.title}"`);
    await titleField.click();
    await page.waitForTimeout(200);

    // Clear any existing content and type the title
    await titleField.fill(blogData.title);
    await page.waitForTimeout(500);

    logger.info('Title filled successfully');

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Fill the CONTENT editor
    // Based on DOM inspection: div.be-editable[contenteditable="true"]
    // ═══════════════════════════════════════════════════════════════

    logger.info('Looking for content editor...');

    // The content editor is a div with class "be-editable"
    const contentEditor = await page.$('div.be-editable[contenteditable="true"]');

    if (!contentEditor) {
      // Fallback to any contenteditable div
      const fallback = await page.$('div[contenteditable="true"]');
      if (!fallback) {
        throw new Error('Could not find content editor (div.be-editable)');
      }
    }

    const editor = contentEditor || await page.$('div[contenteditable="true"]');

    logger.info('Filling content editor...');

    // Click on the content editor to focus it
    await editor.click();
    await page.waitForTimeout(300);

    // Prepare content (remove title heading if present since we filled title separately)
    let contentToAdd = blogData.content;
    if (contentToAdd.startsWith('# ')) {
      // Remove the first heading line (title)
      contentToAdd = contentToAdd.replace(/^#[^\n]*\n+/, '');
    }

    // Try using execCommand for inserting text (faster than keyboard)
    try {
      await page.evaluate((content) => {
        const editor = document.querySelector('div.be-editable[contenteditable="true"]') ||
                       document.querySelector('div[contenteditable="true"]');
        if (editor) {
          editor.focus();
          // Clear existing content
          editor.innerHTML = '';
          // Insert new content using execCommand
          document.execCommand('insertText', false, content);
        }
      }, contentToAdd);

      await page.waitForTimeout(500);

      // Verify content was added
      const editorText = await editor.innerText();
      if (editorText.length < 50 && contentToAdd.length > 100) {
        throw new Error('Content insertion via execCommand failed');
      }

      logger.info('Filled content using execCommand');
    } catch (e) {
      // Fall back to keyboard typing
      logger.info('Falling back to keyboard typing for content...');
      await editor.click();
      await page.waitForTimeout(200);

      // Select all and clear
      await page.keyboard.press('Meta+A');
      await page.waitForTimeout(100);

      // Type content (this is slower but reliable)
      await page.keyboard.type(contentToAdd, { delay: 0 });
      logger.info('Filled content using keyboard typing');
    }

    // Wait for the editor to process the content
    await page.waitForTimeout(1000);

    // Take a screenshot before publishing (for debugging)
    await page.screenshot({ 
      path: join(homedir(), 'content-automation', 'data', 'blog-drafts', 'pre-publish-screenshot.png'),
      fullPage: true 
    });
    logger.info('Saved pre-publish screenshot');

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: SAVE DRAFT FIRST (required before publishing)
    // The Publish button is only enabled AFTER saving a draft
    // ═══════════════════════════════════════════════════════════════
    logger.info('Saving draft first (required before publishing)...');

    const saveDraftButton = await page.$('button:has-text("Save Draft")');
    if (!saveDraftButton) {
      throw new Error('Could not find Save Draft button');
    }

    // Click Save Draft
    await saveDraftButton.click();
    logger.info('Clicked Save Draft, waiting for save to complete...');

    // Wait for the URL to change (indicates draft was saved with UUID)
    // URL changes from /blog/new to /blog/{uuid}/edit/translations/en
    try {
      await page.waitForURL(/\/blog\/[a-f0-9-]+\/edit/, { timeout: 15000 });
      logger.info('Draft saved successfully, URL updated');
    } catch (e) {
      // Fallback: wait a fixed time if URL doesn't change as expected
      logger.info('URL did not change as expected, waiting 5s...');
      await page.waitForTimeout(5000);
    }

    const savedUrl = page.url();
    logger.info(`Current URL after save: ${savedUrl}`);

    // Give the page time to update button states
    await page.waitForTimeout(1000);

    // ═══════════════════════════════════════════════════════════════
    // STEP 4: PUBLISH - Now the publish button should be enabled
    // ═══════════════════════════════════════════════════════════════
    logger.info('Looking for publish button...');

    // The publish button has class "publish-button" based on DOM inspection
    const publishSelectors = [
      'button.publish-button',
      'button:has-text("Publish")',
      '.publish-button',
      'button[type="submit"]'
    ];

    let publishButton = null;
    for (const selector of publishSelectors) {
      const element = await page.$(selector);
      if (element) {
        publishButton = element;
        logger.info(`Found publish button: ${selector}`);
        break;
      }
    }

    if (!publishButton) {
      // Try finding by text content
      const buttons = await page.$$('button');
      for (const button of buttons) {
        const text = await button.innerText().catch(() => '');
        if (text.toLowerCase().includes('publish')) {
          publishButton = button;
          logger.info(`Found publish button by text: ${text}`);
          break;
        }
      }
    }

    if (!publishButton) {
      throw new Error('Could not find publish button');
    }

    // Check if button is enabled (should be after saving draft)
    let isEnabled = await publishButton.isEnabled();
    if (!isEnabled) {
      // Wait a bit more and retry
      logger.info('Publish button not yet enabled, waiting...');
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(500);
        isEnabled = await publishButton.isEnabled();
        if (isEnabled) break;
      }
    }

    if (!isEnabled) {
      await page.screenshot({
        path: join(homedir(), 'content-automation', 'data', 'blog-drafts', 'button-disabled-screenshot.png'),
        fullPage: true
      });
      throw new Error('Publish button still disabled after saving draft - check button-disabled-screenshot.png');
    }

    logger.info('Publish button is enabled, clicking...');
    await publishButton.click();

    // Wait for navigation or success indicator
    await Promise.race([
      page.waitForNavigation({ timeout: 15000 }),
      page.waitForSelector('.success, [class*="success"], .notification', { timeout: 15000 }),
      page.waitForTimeout(5000)
    ]).catch(() => {});

    // Take a screenshot after publishing
    await page.screenshot({ 
      path: join(homedir(), 'content-automation', 'data', 'blog-drafts', 'post-publish-screenshot.png'),
      fullPage: true 
    });
    
    const finalUrl = page.url();
    logger.info(`Publishing complete. Final URL: ${finalUrl}`);
    
    return {
      success: true,
      url: finalUrl,
      message: 'Blog post published successfully'
    };
    
  } catch (error) {
    // Take screenshot on error
    await page.screenshot({ 
      path: join(homedir(), 'content-automation', 'data', 'blog-drafts', 'error-screenshot.png'),
      fullPage: true 
    }).catch(() => {});
    
    return {
      success: false,
      error: error.message,
      pageUrl: page.url()
    };
  }
}

/**
 * Check if automation profile exists and is logged in
 */
export async function isSessionValid() {
  const profilePath = getAutomationProfilePath();
  if (!existsSync(profilePath)) {
    return false;
  }
  
  let context = null;
  try {
    context = await chromium.launchPersistentContext(profilePath, {
      headless: true
    });
    
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.arcblock.io/blog/blog/new', {
      waitUntil: 'networkidle',
      timeout: 15000
    });
    
    const currentUrl = page.url();
    const isLoginPage = currentUrl.includes('/login') || 
                       currentUrl.includes('/auth') ||
                       await page.$('[class*="login-form"]') !== null;
    
    await context.close();
    
    return !isLoginPage;
  } catch (error) {
    if (context) await context.close();
    return false;
  }
}

/**
 * Initialize automation profile with manual login
 * Run this once to set up the persistent profile
 */
export async function setupProfile(logger) {
  const profilePath = getAutomationProfilePath();
  
  logger.info('Setting up automation profile for ArcBlock blog...');
  logger.info(`Profile location: ${profilePath}`);
  
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false, // Must be visible for manual login
    viewport: { width: 1280, height: 900 }
  });
  
  const page = context.pages()[0] || await context.newPage();
  
  logger.info('Opening ArcBlock blog editor...');
  await page.goto('https://www.arcblock.io/blog/blog/new');
  
  logger.info('');
  logger.info('═══════════════════════════════════════════════════════════════');
  logger.info('  MANUAL ACTION REQUIRED');
  logger.info('═══════════════════════════════════════════════════════════════');
  logger.info('  1. Log in to your ArcBlock account in the browser window');
  logger.info('  2. Make sure you can see the blog editor page');
  logger.info('  3. Close the browser window when done');
  logger.info('═══════════════════════════════════════════════════════════════');
  
  // Wait for user to close the browser
  await new Promise(resolve => {
    context.on('close', resolve);
  });
  
  logger.info('Profile setup complete! Your login is saved.');
}

export default {
  launchBrowser,
  publishBlogPost,
  isSessionValid,
  setupProfile,
  getAutomationProfilePath
};
