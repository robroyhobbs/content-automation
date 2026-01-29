/**
 * ArcSphere Weekly Social Content Generator
 *
 * Processes new ArcSphere releases and generates social media content
 * for X (personal + ArcBlock) and LinkedIn (personal + ArcBlock).
 *
 * Workflow:
 *   1. Check incoming/ for new release folders
 *   2. Read features.yaml and list videos
 *   3. Generate content for each account
 *   4. Submit for human review
 *   5. Archive to completed/ after approval
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');

// Dynamic import for social poster (avoids circular dependencies)
let socialPoster = null;
async function getSocialPoster() {
  if (!socialPoster) {
    socialPoster = await import('../../hub/shared/social-poster.mjs');
  }
  return socialPoster;
}

/**
 * Main task runner
 */
async function run(context) {
  const { taskName, config, logger, state } = context;

  logger.info('Starting ArcSphere social content generation');

  const { incomingPath, completedPath, draftsPath } = config.settings;
  const incomingDir = path.resolve(ROOT_DIR, incomingPath);
  const draftsDir = path.resolve(ROOT_DIR, draftsPath);

  // Ensure drafts directory exists
  await fs.mkdir(draftsDir, { recursive: true });

  // Find pending releases
  const releases = await findPendingReleases(incomingDir, logger);

  if (releases.length === 0) {
    logger.info('No new releases to process');
    return {
      success: true,
      output: 'No new releases found in incoming folder',
      metadata: { releasesProcessed: 0 }
    };
  }

  const results = [];

  for (const release of releases) {
    logger.info(`Processing release: ${release.version}`);

    try {
      // Load release data
      const features = await loadFeatures(release.path);
      const videos = await listVideos(release.path);

      logger.info(`Found ${Object.keys(features.features).length} features and ${videos.length} videos`);

      // Generate content for all accounts
      const content = await generateContent(features, videos, config.settings, logger);

      // Save drafts
      const draftPath = path.join(draftsDir, release.version);
      await fs.mkdir(draftPath, { recursive: true });
      await saveDrafts(content, draftPath);

      // Create review items
      const reviewItems = createReviewItems(content, release.version, features);

      results.push({
        version: release.version,
        features: Object.keys(features.features).length,
        videos: videos.length,
        drafts: Object.keys(content).length,
        reviewItems: reviewItems.length
      });

      logger.info(`Generated ${Object.keys(content).length} content drafts for ${release.version}`);

    } catch (error) {
      logger.error(`Failed to process release ${release.version}: ${error.message}`);
      results.push({
        version: release.version,
        error: error.message
      });
    }
  }

  const successCount = results.filter(r => !r.error).length;

  return {
    success: successCount > 0,
    output: `Processed ${successCount}/${releases.length} releases. Check drafts folder and review queue.`,
    metadata: {
      releasesProcessed: successCount,
      results
    },
    reviewRequired: true
  };
}

/**
 * Find release folders in incoming directory
 */
async function findPendingReleases(incomingDir, logger) {
  const releases = [];

  try {
    const entries = await fs.readdir(incomingDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('v')) {
        const releasePath = path.join(incomingDir, entry.name);
        const featuresPath = path.join(releasePath, 'features.yaml');

        try {
          await fs.access(featuresPath);
          releases.push({
            version: entry.name,
            path: releasePath
          });
          logger.info(`Found release: ${entry.name}`);
        } catch {
          logger.warn(`Skipping ${entry.name}: no features.yaml found`);
        }
      }
    }
  } catch (error) {
    logger.error(`Error reading incoming directory: ${error.message}`);
  }

  return releases;
}

/**
 * Load features.yaml from release folder
 */
async function loadFeatures(releasePath) {
  const featuresPath = path.join(releasePath, 'features.yaml');
  const content = await fs.readFile(featuresPath, 'utf-8');
  return yaml.load(content);
}

/**
 * List video files in release folder
 */
async function listVideos(releasePath) {
  const videosDir = path.join(releasePath, 'videos');
  const videos = [];

  try {
    const entries = await fs.readdir(videosDir);
    for (const entry of entries) {
      if (entry.match(/\.(mp4|mov|MP4|MOV)$/i)) {
        const stat = await fs.stat(path.join(videosDir, entry));
        videos.push({
          filename: entry,
          path: path.join(videosDir, entry),
          size: stat.size
        });
      }
    }
  } catch (error) {
    // No videos directory
  }

  return videos;
}

/**
 * Generate content for all configured accounts
 */
async function generateContent(features, videos, settings, logger) {
  const content = {};
  const { accounts, contentSettings, brand } = settings;

  // Build context for content generation
  const context = {
    version: features.version,
    tagline: features.tagline || brand.tagline,
    features: features.features,
    priorityOrder: features.priority_order || Object.keys(features.features),
    videos,
    brand
  };

  // X Personal
  if (accounts.x.personal.enabled) {
    content['x-personal'] = generateXPersonal(context, accounts.x.personal, contentSettings);
    logger.info('Generated X personal content');
  }

  // X ArcBlock
  if (accounts.x.arcblock.enabled) {
    content['x-arcblock'] = generateXCorporate(context, accounts.x.arcblock, contentSettings);
    logger.info('Generated X ArcBlock content');
  }

  // LinkedIn Personal
  if (accounts.linkedin.personal.enabled) {
    content['linkedin-personal'] = generateLinkedInPersonal(context, accounts.linkedin.personal, contentSettings);
    logger.info('Generated LinkedIn personal content');
  }

  // LinkedIn ArcBlock
  if (accounts.linkedin.arcblock.enabled) {
    content['linkedin-arcblock'] = generateLinkedInCorporate(context, accounts.linkedin.arcblock, contentSettings);
    logger.info('Generated LinkedIn ArcBlock content');
  }

  return content;
}

/**
 * Generate X personal post (casual, first-person)
 */
function generateXPersonal(context, accountConfig, contentSettings) {
  const primaryFeature = context.features[context.priorityOrder[0]];
  const hashtags = contentSettings.defaultHashtags.slice(0, contentSettings.maxHashtags).join(' ');

  const posts = [];

  // Main announcement post
  posts.push({
    type: 'announcement',
    text: `Just shipped ArcSphere ${context.version}! ${context.tagline}

${primaryFeature.messaging.hook}

${primaryFeature.messaging.benefit}

${hashtags}`,
    video: primaryFeature.videos?.[0] || null
  });

  // Feature deep-dive posts
  for (const [id, feature] of Object.entries(context.features)) {
    posts.push({
      type: 'feature',
      featureId: id,
      text: `${feature.messaging.hook}

${feature.description}

Try it in ArcSphere ${context.version} ${hashtags}`,
      video: feature.videos?.[0] || null
    });
  }

  return {
    account: 'personal',
    platform: 'x',
    tone: accountConfig.tone,
    posts
  };
}

/**
 * Generate X corporate post (professional, brand-aligned)
 */
function generateXCorporate(context, accountConfig, contentSettings) {
  const hashtags = contentSettings.defaultHashtags.slice(0, contentSettings.maxHashtags).join(' ');

  const posts = [];

  // Main announcement
  posts.push({
    type: 'announcement',
    text: `ArcSphere ${context.version} is here.

${context.tagline}

New in this release:
${Object.values(context.features).map(f => `• ${f.short_name}`).join('\n')}

${hashtags}`,
    video: context.videos[0]?.filename || null
  });

  return {
    account: 'arcblock',
    platform: 'x',
    tone: accountConfig.tone,
    posts
  };
}

/**
 * Generate LinkedIn personal post (thought leadership)
 */
function generateLinkedInPersonal(context, accountConfig, contentSettings) {
  const features = Object.values(context.features);
  const hashtags = contentSettings.defaultHashtags.join(' ');

  const posts = [];

  posts.push({
    type: 'announcement',
    text: `Excited to share what we've been working on: ArcSphere ${context.version}

${context.tagline}

Two features I'm particularly proud of:

${features.map(f => `**${f.name}**
${f.messaging.benefit}`).join('\n\n')}

These might seem like small improvements, but they represent our commitment to making AI accessible from anywhere, anytime.

What features matter most to you in an AI browser? I'd love to hear your thoughts.

${hashtags}`,
    videos: context.videos.map(v => v.filename)
  });

  return {
    account: 'personal',
    platform: 'linkedin',
    tone: accountConfig.tone,
    posts
  };
}

/**
 * Generate LinkedIn corporate post (company announcement)
 */
function generateLinkedInCorporate(context, accountConfig, contentSettings) {
  const features = Object.values(context.features);
  const hashtags = contentSettings.defaultHashtags.join(' ');

  const posts = [];

  posts.push({
    type: 'announcement',
    text: `ArcSphere ${context.version} Release

${context.tagline}

We're pleased to announce the latest update to ArcSphere, your AI-powered browser for the modern web.

**What's New:**

${features.map(f => `**${f.name}**
${f.description}
${f.messaging.proof}`).join('\n\n')}

Download ArcSphere today and experience the future of browsing.

${hashtags}`,
    videos: context.videos.map(v => v.filename)
  });

  return {
    account: 'arcblock',
    platform: 'linkedin',
    tone: accountConfig.tone,
    posts
  };
}

/**
 * Save draft content to files
 */
async function saveDrafts(content, draftPath) {
  for (const [key, data] of Object.entries(content)) {
    const filePath = path.join(draftPath, `${key}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));

    // Also save human-readable markdown
    const mdPath = path.join(draftPath, `${key}.md`);
    const md = formatAsMarkdown(data);
    await fs.writeFile(mdPath, md);
  }
}

/**
 * Format content as markdown for easy review
 */
function formatAsMarkdown(data) {
  let md = `# ${data.platform.toUpperCase()} - ${data.account}\n\n`;
  md += `**Tone:** ${data.tone}\n\n`;
  md += `---\n\n`;

  for (const post of data.posts) {
    md += `## ${post.type.charAt(0).toUpperCase() + post.type.slice(1)}\n\n`;
    md += `${post.text}\n\n`;
    if (post.video) {
      md += `**Video:** ${post.video}\n\n`;
    }
    if (post.videos) {
      md += `**Videos:** ${post.videos.join(', ')}\n\n`;
    }
    md += `---\n\n`;
  }

  return md;
}

/**
 * Create review items for the review queue
 */
function createReviewItems(content, version, features) {
  const items = [];

  for (const [key, data] of Object.entries(content)) {
    items.push({
      id: `arcsphere-${version}-${key}`,
      type: 'social-content',
      title: `ArcSphere ${version} - ${data.platform} ${data.account}`,
      platform: data.platform,
      account: data.account,
      postCount: data.posts.length,
      createdAt: new Date().toISOString()
    });
  }

  return items;
}

/**
 * Get current status of the task
 */
async function getStatus(context) {
  const { config } = context;
  const incomingDir = path.resolve(ROOT_DIR, config.settings.incomingPath);

  let pending = 0;
  try {
    const entries = await fs.readdir(incomingDir, { withFileTypes: true });
    pending = entries.filter(e => e.isDirectory() && e.name.startsWith('v')).length;
  } catch {
    // Directory doesn't exist
  }

  return {
    healthy: true,
    pending,
    queued: 0
  };
}

/**
 * Cleanup resources
 */
async function cleanup(context) {
  // No cleanup needed for this task
}

/**
 * Archive release after approval
 */
async function archiveRelease(releasePath, completedPath, logger) {
  const releaseName = path.basename(releasePath);
  const destPath = path.join(completedPath, releaseName);

  await fs.rename(releasePath, destPath);
  logger.info(`Archived ${releaseName} to completed/`);
}

/**
 * Publish approved content to social media
 * Called after human approves the review
 */
async function publish(context, version) {
  const { config, logger } = context;
  const poster = await getSocialPoster();

  const { draftsPath, incomingPath, completedPath } = config.settings;
  const draftDir = path.resolve(ROOT_DIR, draftsPath, version);
  const videosDir = path.resolve(ROOT_DIR, incomingPath, version, 'videos');

  logger.info(`Publishing approved content for ${version}`);

  // Check credential status
  const credStatus = await poster.getCredentialStatus();
  logger.info('Credential status:', JSON.stringify(credStatus));

  const results = {
    published: [],
    failed: [],
    simulated: []
  };

  // Read all draft files
  const drafts = await fs.readdir(draftDir);

  for (const draftFile of drafts) {
    if (!draftFile.endsWith('.json')) continue;

    const draftPath = path.join(draftDir, draftFile);
    const draft = JSON.parse(await fs.readFile(draftPath, 'utf-8'));

    const { platform, account, posts } = draft;

    // Post each item
    for (const post of posts) {
      // Resolve video path
      let videoPath = null;
      if (post.video) {
        videoPath = path.join(videosDir, post.video);
        try {
          await fs.access(videoPath);
        } catch {
          logger.warn(`Video not found: ${post.video}`);
          videoPath = null;
        }
      }

      logger.info(`Posting to ${platform}/${account}: ${post.type}`);

      const result = await poster.post(platform, account, {
        text: post.text,
        videoPath
      });

      if (result.success) {
        if (result.simulated) {
          results.simulated.push({
            platform,
            account,
            type: post.type,
            message: result.message
          });
          logger.info(`Simulated post to ${platform}/${account}`);
        } else {
          results.published.push({
            platform,
            account,
            type: post.type,
            postId: result.postId,
            url: result.url
          });
          logger.info(`Published to ${platform}/${account}: ${result.url}`);
        }
      } else {
        results.failed.push({
          platform,
          account,
          type: post.type,
          error: result.error
        });
        logger.error(`Failed to post to ${platform}/${account}: ${result.error}`);
      }

      // Rate limit: wait between posts
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Archive the release if any posts succeeded
  if (results.published.length > 0 || results.simulated.length > 0) {
    const incomingReleasePath = path.resolve(ROOT_DIR, incomingPath, version);
    const completedReleasePath = path.resolve(ROOT_DIR, completedPath, version);

    try {
      await fs.mkdir(path.dirname(completedReleasePath), { recursive: true });
      await fs.rename(incomingReleasePath, completedReleasePath);
      logger.info(`Archived ${version} to completed/`);
    } catch (error) {
      logger.warn(`Could not archive release: ${error.message}`);
    }
  }

  return {
    success: results.failed.length === 0,
    output: `Published ${results.published.length}, simulated ${results.simulated.length}, failed ${results.failed.length}`,
    metadata: results
  };
}

/**
 * Handle review approval - triggers publishing
 */
async function onApprove(context, reviewId) {
  const { logger } = context;

  // Extract version from review ID (format: arcsphere-v1.10-x-personal)
  const match = reviewId.match(/arcsphere-(v[\d.]+)/);
  if (!match) {
    logger.error(`Invalid review ID format: ${reviewId}`);
    return { success: false, error: 'Invalid review ID format' };
  }

  const version = match[1];
  logger.info(`Review approved for ${version}, starting publish...`);

  return publish(context, version);
}

/**
 * CLI entry point for manual publishing
 */
async function manualPublish(version) {
  const configPath = path.join(__dirname, 'task.yaml');
  const configContent = await fs.readFile(configPath, 'utf-8');
  const config = yaml.load(configContent);

  const context = {
    config,
    logger: {
      info: (...args) => console.log('[INFO]', ...args),
      warn: (...args) => console.warn('[WARN]', ...args),
      error: (...args) => console.error('[ERROR]', ...args)
    }
  };

  return publish(context, version);
}

// Allow CLI usage: node runner.mjs publish v1.10
if (process.argv[2] === 'publish' && process.argv[3]) {
  manualPublish(process.argv[3])
    .then(result => {
      console.log('\nPublish Result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Publish failed:', error);
      process.exit(1);
    });
}

export default { run, getStatus, cleanup, publish, onApprove };
export { archiveRelease, publish, manualPublish };
