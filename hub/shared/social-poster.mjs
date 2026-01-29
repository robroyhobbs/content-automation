/**
 * Social Media Posting Service
 *
 * Handles automated posting to X (Twitter) and LinkedIn
 * with video upload support.
 *
 * Requires credentials in config/credentials.yaml:
 *   x:
 *     personal:
 *       apiKey: "..."
 *       apiSecret: "..."
 *       accessToken: "..."
 *       accessSecret: "..."
 *     arcblock:
 *       apiKey: "..."
 *       apiSecret: "..."
 *       accessToken: "..."
 *       accessSecret: "..."
 *   linkedin:
 *     personal:
 *       accessToken: "..."
 *     arcblock:
 *       accessToken: "..."
 *       organizationId: "..."
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const CREDENTIALS_PATH = path.join(ROOT_DIR, 'config', 'credentials.yaml');

/**
 * Load social media credentials
 */
async function loadCredentials() {
  try {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
    return yaml.load(content);
  } catch (error) {
    console.error('Failed to load credentials:', error.message);
    return null;
  }
}

/**
 * Post to X (Twitter) API v2
 */
async function postToX(account, text, mediaPath = null, credentials) {
  const creds = credentials?.x?.[account];

  if (!creds || !creds.accessToken) {
    // Simulate post when credentials not configured
    return simulatePost('x', account, text, mediaPath);
  }

  try {
    // For now, we'll use the twitter-api-v2 package if available
    // or simulate the post for review
    const { TwitterApi } = await import('twitter-api-v2').catch(() => null);

    if (!TwitterApi) {
      return simulatePost('x', account, text, mediaPath);
    }

    const client = new TwitterApi({
      appKey: creds.apiKey,
      appSecret: creds.apiSecret,
      accessToken: creds.accessToken,
      accessSecret: creds.accessSecret,
    });

    let mediaId = null;

    // Upload media if provided
    if (mediaPath) {
      try {
        mediaId = await client.v1.uploadMedia(mediaPath);
      } catch (mediaError) {
        console.warn('Failed to upload media:', mediaError.message);
      }
    }

    // Post tweet
    const tweetOptions = { text };
    if (mediaId) {
      tweetOptions.media = { media_ids: [mediaId] };
    }

    const result = await client.v2.tweet(tweetOptions);

    return {
      success: true,
      platform: 'x',
      account,
      postId: result.data.id,
      url: `https://x.com/${creds.handle || account}/status/${result.data.id}`,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    return {
      success: false,
      platform: 'x',
      account,
      error: error.message
    };
  }
}

/**
 * Post to LinkedIn API
 */
async function postToLinkedIn(account, text, mediaPath = null, credentials) {
  const creds = credentials?.linkedin?.[account];

  if (!creds || !creds.accessToken) {
    // Simulate post when credentials not configured
    return simulatePost('linkedin', account, text, mediaPath);
  }

  try {
    const accessToken = creds.accessToken;
    const isOrganization = account === 'arcblock' && creds.organizationId;
    const authorUrn = isOrganization
      ? `urn:li:organization:${creds.organizationId}`
      : `urn:li:person:${creds.personId}`;

    // Prepare post payload
    const postPayload = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: {
            text: text
          },
          shareMediaCategory: mediaPath ? 'VIDEO' : 'NONE'
        }
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
      }
    };

    // Upload media if provided (LinkedIn requires separate upload flow)
    if (mediaPath) {
      const mediaUrn = await uploadLinkedInVideo(mediaPath, authorUrn, accessToken);
      if (mediaUrn) {
        postPayload.specificContent['com.linkedin.ugc.ShareContent'].media = [{
          status: 'READY',
          media: mediaUrn
        }];
        postPayload.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory = 'VIDEO';
      }
    }

    // Post to LinkedIn
    const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0'
      },
      body: JSON.stringify(postPayload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`LinkedIn API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    const postId = result.id?.replace('urn:li:share:', '') || result.id;

    return {
      success: true,
      platform: 'linkedin',
      account,
      postId,
      url: isOrganization
        ? `https://www.linkedin.com/feed/update/${result.id}`
        : `https://www.linkedin.com/feed/update/${result.id}`,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    return {
      success: false,
      platform: 'linkedin',
      account,
      error: error.message
    };
  }
}

/**
 * Upload video to LinkedIn (requires multi-step upload)
 */
async function uploadLinkedInVideo(videoPath, authorUrn, accessToken) {
  try {
    const videoStat = await fs.stat(videoPath);
    const videoSize = videoStat.size;

    // Step 1: Initialize upload
    const initResponse = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-video'],
          owner: authorUrn,
          serviceRelationships: [{
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent'
          }]
        }
      })
    });

    if (!initResponse.ok) {
      throw new Error('Failed to initialize LinkedIn upload');
    }

    const initData = await initResponse.json();
    const uploadUrl = initData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
    const asset = initData.value.asset;

    // Step 2: Upload video file
    const videoBuffer = await fs.readFile(videoPath);
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream'
      },
      body: videoBuffer
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload video to LinkedIn');
    }

    return asset;

  } catch (error) {
    console.error('LinkedIn video upload failed:', error.message);
    return null;
  }
}

/**
 * Simulate a post (for testing or when credentials missing)
 */
function simulatePost(platform, account, text, mediaPath) {
  const simulatedId = `sim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  return {
    success: true,
    simulated: true,
    platform,
    account,
    postId: simulatedId,
    text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
    media: mediaPath ? path.basename(mediaPath) : null,
    message: 'Post simulated (credentials not configured)',
    timestamp: new Date().toISOString()
  };
}

/**
 * Post content to a specific platform and account
 */
async function post(platform, account, content, options = {}) {
  const credentials = await loadCredentials();

  const { text, videoPath } = content;

  switch (platform) {
    case 'x':
      return postToX(account, text, videoPath, credentials);
    case 'linkedin':
      return postToLinkedIn(account, text, videoPath, credentials);
    default:
      return {
        success: false,
        error: `Unknown platform: ${platform}`
      };
  }
}

/**
 * Post all content from a draft folder
 */
async function postAllFromDrafts(draftPath, videosPath, options = {}) {
  const results = [];
  const credentials = await loadCredentials();

  const drafts = await fs.readdir(draftPath);

  for (const draft of drafts) {
    if (!draft.endsWith('.json')) continue;

    const draftFile = path.join(draftPath, draft);
    const draftContent = JSON.parse(await fs.readFile(draftFile, 'utf-8'));

    for (const post of draftContent.posts || []) {
      // Get video path if specified
      let videoPath = null;
      if (post.video && videosPath) {
        videoPath = path.join(videosPath, post.video);
        try {
          await fs.access(videoPath);
        } catch {
          videoPath = null;
        }
      }

      const result = await postContent(
        draftContent.platform,
        draftContent.account,
        { text: post.text, videoPath },
        credentials
      );

      results.push({
        ...result,
        type: post.type,
        draftFile: draft
      });

      // Rate limiting: wait between posts
      if (!options.skipDelay) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  return results;
}

/**
 * Internal post function with credentials
 */
async function postContent(platform, account, content, credentials) {
  switch (platform) {
    case 'x':
      return postToX(account, content.text, content.videoPath, credentials);
    case 'linkedin':
      return postToLinkedIn(account, content.text, content.videoPath, credentials);
    default:
      return simulatePost(platform, account, content.text, content.videoPath);
  }
}

/**
 * Check if credentials are configured for an account
 */
async function hasCredentials(platform, account) {
  const credentials = await loadCredentials();
  return !!credentials?.[platform]?.[account];
}

/**
 * Get credential status for all accounts
 */
async function getCredentialStatus() {
  const credentials = await loadCredentials();

  return {
    x: {
      personal: !!credentials?.x?.personal?.accessToken,
      arcblock: !!credentials?.x?.arcblock?.accessToken
    },
    linkedin: {
      personal: !!credentials?.linkedin?.personal?.accessToken,
      arcblock: !!credentials?.linkedin?.arcblock?.accessToken
    }
  };
}

export {
  post,
  postAllFromDrafts,
  hasCredentials,
  getCredentialStatus,
  loadCredentials
};

export default {
  post,
  postAllFromDrafts,
  hasCredentials,
  getCredentialStatus
};
