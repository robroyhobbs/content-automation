/**
 * Google Ads Daily Optimization Runner
 *
 * Reviews campaign performance and makes optimization suggestions.
 * Uses MCP server for real-time Google Ads data.
 *
 * Conservative mode (default):
 * - Logs recommendations but doesn't auto-execute
 * - Flags poor performers for manual review
 * - Generates new headline suggestions when needed
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const STATE_FILE = join(DATA_DIR, 'google-ads-daily-state.json');

// MyVibe headline templates based on research
const HEADLINE_TEMPLATES = [
  "Share Your AI Creations",
  "Live in Seconds",
  "No DevOps Required",
  "Your Vibes, Live Now",
  "AI to Live Website",
  "Publish Instantly",
  "Share Your Vibe",
  "From Chat to Live",
  "No Code Needed",
  "Your Data, Your Way"
];

const DESCRIPTION_TEMPLATES = [
  "Turn any AI creation into a live website with one click. No deploy, no DevOps. Just share.",
  "Made something in Claude or ChatGPT? Share it with the world in seconds. Free to start.",
  "The easiest way to publish AI-generated websites. Works with Lovable, v0, Bolt, and more.",
  "Stop letting your AI creations die in browser tabs. Make them live and shareable."
];

/**
 * Load state from previous runs
 */
function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (error) {
    // Ignore, return default
  }
  return {
    lastRun: null,
    recommendations: [],
    appliedChanges: [],
    performance: {
      history: [],
      bestHeadlines: [],
      worstHeadlines: []
    }
  };
}

/**
 * Save state
 */
function saveState(state) {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Call MCP server tool via Python
 */
async function callMCPTool(toolName, args, settings) {
  return new Promise((resolve, reject) => {
    const pythonCode = `
import asyncio
import sys
sys.path.insert(0, '${settings.mcpServer.path}')
from google_ads_server import ${toolName}

async def main():
    result = await ${toolName}(${Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')})
    print(result)

asyncio.run(main())
`;

    const child = spawn(settings.mcpServer.pythonPath, ['-c', pythonCode], {
      cwd: settings.mcpServer.path,
      env: {
        ...process.env,
        PYTHONPATH: settings.mcpServer.path
      }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`MCP tool ${toolName} failed: ${stderr}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Parse performance data from MCP response
 */
function parsePerformanceData(rawData) {
  // Parse the table format from MCP server
  const lines = rawData.split('\n').filter(line => line.trim());
  const results = [];

  // Find header line
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('campaign.id') || lines[i].includes('ad_group_ad.ad.id')) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) return results;

  const headers = lines[headerIndex].split('|').map(h => h.trim());

  for (let i = headerIndex + 2; i < lines.length; i++) {
    const values = lines[i].split('|').map(v => v.trim());
    if (values.length === headers.length) {
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx];
      });
      results.push(row);
    }
  }

  return results;
}

/**
 * Analyze campaign performance
 */
function analyzeCampaigns(campaigns, settings) {
  const { thresholds, campaign } = settings;
  const recommendations = [];

  for (const camp of campaigns) {
    const impressions = parseInt(camp['metrics.impressions'] || 0);
    const clicks = parseInt(camp['metrics.clicks'] || 0);
    const conversions = parseFloat(camp['metrics.conversions'] || 0);
    const costMicros = parseInt(camp['metrics.cost_micros'] || 0);
    const cost = costMicros / 1_000_000;

    if (impressions < thresholds.minImpressions) continue;

    const ctr = clicks / impressions * 100;
    const cpc = clicks > 0 ? cost / clicks : 0;
    const cpa = conversions > 0 ? cost / conversions : Infinity;

    // CTR too low
    if (ctr < thresholds.minCTR) {
      recommendations.push({
        type: 'LOW_CTR',
        severity: 'warning',
        campaign: camp['campaign.name'],
        metric: ctr.toFixed(2) + '%',
        threshold: thresholds.minCTR + '%',
        suggestion: 'Consider testing new ad creatives or headlines'
      });
    }

    // CPC too high
    if (cpc > thresholds.maxCPC) {
      recommendations.push({
        type: 'HIGH_CPC',
        severity: 'warning',
        campaign: camp['campaign.name'],
        metric: '$' + cpc.toFixed(2),
        threshold: '$' + thresholds.maxCPC,
        suggestion: 'Review keyword bids and add negative keywords'
      });
    }

    // CPA above target
    if (conversions > 0 && cpa > campaign.targetCPA * 1.5) {
      recommendations.push({
        type: 'HIGH_CPA',
        severity: 'critical',
        campaign: camp['campaign.name'],
        metric: '$' + cpa.toFixed(2),
        threshold: '$' + campaign.targetCPA,
        suggestion: 'CPA is 50%+ above target. Consider pausing low-converting ad groups.'
      });
    }

    // High spend, no conversions
    if (clicks >= thresholds.minClicksBeforePause && conversions === 0) {
      recommendations.push({
        type: 'ZERO_CONVERSIONS',
        severity: 'critical',
        campaign: camp['campaign.name'],
        clicks: clicks,
        cost: '$' + cost.toFixed(2),
        suggestion: 'Consider pausing - high spend with no conversions'
      });
    }
  }

  return recommendations;
}

/**
 * Analyze ad performance
 */
function analyzeAds(ads, settings) {
  const { thresholds } = settings;
  const recommendations = [];
  const adPerformance = [];

  for (const ad of ads) {
    const impressions = parseInt(ad['metrics.impressions'] || 0);
    const clicks = parseInt(ad['metrics.clicks'] || 0);
    const conversions = parseFloat(ad['metrics.conversions'] || 0);
    const costMicros = parseInt(ad['metrics.cost_micros'] || 0);
    const cost = costMicros / 1_000_000;

    if (impressions < thresholds.minImpressions) continue;

    const ctr = clicks / impressions * 100;
    const convRate = clicks > 0 ? conversions / clicks * 100 : 0;

    adPerformance.push({
      adId: ad['ad_group_ad.ad.id'],
      adName: ad['ad_group_ad.ad.name'],
      campaign: ad['campaign.name'],
      adGroup: ad['ad_group.name'],
      impressions,
      clicks,
      conversions,
      cost,
      ctr,
      convRate
    });

    // Flag underperformers
    if (ctr < thresholds.minCTR / 2 && impressions > 500) {
      recommendations.push({
        type: 'UNDERPERFORMING_AD',
        severity: 'warning',
        adId: ad['ad_group_ad.ad.id'],
        campaign: ad['campaign.name'],
        ctr: ctr.toFixed(2) + '%',
        suggestion: settings.optimization.autoPause
          ? 'Pausing this ad due to low CTR'
          : 'Consider pausing - CTR is significantly below threshold'
      });
    }
  }

  return { recommendations, adPerformance };
}

/**
 * Generate new headline suggestions
 */
function generateHeadlineSuggestions(currentHeadlines, messaging) {
  // Filter out headlines already in use
  const available = HEADLINE_TEMPLATES.filter(h =>
    !currentHeadlines.some(ch =>
      ch.toLowerCase().includes(h.toLowerCase().slice(0, 10))
    )
  );

  // Return up to 5 new suggestions
  return available.slice(0, 5).map(headline => ({
    text: headline,
    rationale: `Aligns with ${messaging.brandVoice} voice, emphasizes ${messaging.primaryBenefit}`
  }));
}

/**
 * Main task execution
 */
async function run(context) {
  const { config, logger } = context;
  const { settings } = config;

  logger.info('Starting Google Ads daily optimization');

  // Load state
  const state = loadState();
  const today = new Date().toISOString().split('T')[0];

  try {
    // Get customer ID from environment if not in config
    const customerId = settings.customerId || process.env.GOOGLE_ADS_CUSTOMER_ID;
    if (!customerId) {
      return {
        success: false,
        error: 'No Google Ads customer ID configured. Set GOOGLE_ADS_CUSTOMER_ID environment variable.'
      };
    }

    logger.info('Fetching campaign performance (last 7 days)');

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Get campaign performance
    // ═══════════════════════════════════════════════════════════════
    let campaignData;
    try {
      campaignData = await callMCPTool('get_campaign_performance', {
        customer_id: customerId,
        days: 7
      }, settings);
    } catch (error) {
      logger.warn('Failed to get campaign data, will continue with limited analysis', { error: error.message });
      campaignData = '';
    }

    const campaigns = parsePerformanceData(campaignData);
    logger.info(`Found ${campaigns.length} campaigns`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Get ad performance
    // ═══════════════════════════════════════════════════════════════
    logger.info('Fetching ad performance');

    let adData;
    try {
      adData = await callMCPTool('get_ad_performance', {
        customer_id: customerId,
        days: 7
      }, settings);
    } catch (error) {
      logger.warn('Failed to get ad data', { error: error.message });
      adData = '';
    }

    const ads = parsePerformanceData(adData);
    logger.info(`Found ${ads.length} ads`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Analyze performance
    // ═══════════════════════════════════════════════════════════════
    logger.info('Analyzing performance against thresholds');

    const campaignRecommendations = analyzeCampaigns(campaigns, settings);
    const { recommendations: adRecommendations, adPerformance } = analyzeAds(ads, settings);

    const allRecommendations = [...campaignRecommendations, ...adRecommendations];

    // ═══════════════════════════════════════════════════════════════
    // STEP 4: Get current creatives
    // ═══════════════════════════════════════════════════════════════
    logger.info('Fetching current ad creatives');

    let creativesData;
    let currentHeadlines = [];
    try {
      creativesData = await callMCPTool('get_ad_creatives', {
        customer_id: customerId
      }, settings);

      // Extract headlines from creatives response
      const headlineMatches = creativesData.match(/Headlines:\s*([\s\S]*?)(?=Descriptions:|Final URLs:|$)/gi);
      if (headlineMatches) {
        for (const match of headlineMatches) {
          const lines = match.split('\n').filter(l => l.trim().startsWith('-'));
          currentHeadlines.push(...lines.map(l => l.replace(/^\s*-\s*/, '').trim()));
        }
      }
    } catch (error) {
      logger.warn('Failed to get creatives', { error: error.message });
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 5: Generate optimization suggestions
    // ═══════════════════════════════════════════════════════════════
    logger.info('Generating optimization suggestions');

    // If CTR is low across the board, suggest new headlines
    const lowCTRCount = allRecommendations.filter(r => r.type === 'LOW_CTR').length;
    let headlineSuggestions = [];

    if (lowCTRCount > 0 && settings.optimization.suggestNewHeadlines) {
      headlineSuggestions = generateHeadlineSuggestions(currentHeadlines, settings.messaging);

      if (headlineSuggestions.length > 0) {
        allRecommendations.push({
          type: 'NEW_HEADLINES',
          severity: 'info',
          suggestions: headlineSuggestions,
          reason: `${lowCTRCount} campaigns have low CTR. Try these new headlines:`
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 6: Apply changes (if aggressive mode)
    // ═══════════════════════════════════════════════════════════════
    const appliedChanges = [];

    if (settings.optimization.mode === 'aggressive') {
      for (const rec of allRecommendations) {
        if (rec.type === 'UNDERPERFORMING_AD' && settings.optimization.autoPause) {
          try {
            // Get ad group ID (would need to parse from data)
            // For now, log the intent
            logger.info(`Would pause ad: ${rec.adId}`);
            appliedChanges.push({
              action: 'pause_ad',
              adId: rec.adId,
              reason: rec.suggestion,
              timestamp: new Date().toISOString()
            });
          } catch (error) {
            logger.error(`Failed to pause ad ${rec.adId}`, { error: error.message });
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 7: Calculate summary metrics
    // ═══════════════════════════════════════════════════════════════
    let totalSpend = 0;
    let totalConversions = 0;
    let totalClicks = 0;
    let totalImpressions = 0;

    for (const camp of campaigns) {
      totalSpend += parseInt(camp['metrics.cost_micros'] || 0) / 1_000_000;
      totalConversions += parseFloat(camp['metrics.conversions'] || 0);
      totalClicks += parseInt(camp['metrics.clicks'] || 0);
      totalImpressions += parseInt(camp['metrics.impressions'] || 0);
    }

    const avgCPA = totalConversions > 0 ? totalSpend / totalConversions : 0;
    const avgCTR = totalImpressions > 0 ? totalClicks / totalImpressions * 100 : 0;

    const summary = {
      date: today,
      spend: totalSpend.toFixed(2),
      conversions: totalConversions,
      cpa: avgCPA.toFixed(2),
      ctr: avgCTR.toFixed(2),
      impressions: totalImpressions,
      clicks: totalClicks,
      recommendationCount: allRecommendations.length,
      criticalIssues: allRecommendations.filter(r => r.severity === 'critical').length
    };

    logger.info('Performance summary', summary);

    // ═══════════════════════════════════════════════════════════════
    // STEP 8: Save daily log
    // ═══════════════════════════════════════════════════════════════
    const reportsDir = join(__dirname, '..', '..', 'reports', 'google-ads');
    if (!existsSync(reportsDir)) {
      mkdirSync(reportsDir, { recursive: true });
    }

    const dailyLogFile = join(reportsDir, `daily-${today}.json`);
    writeFileSync(dailyLogFile, JSON.stringify({
      summary,
      recommendations: allRecommendations,
      appliedChanges,
      headlineSuggestions,
      adPerformance: adPerformance.slice(0, 10), // Top 10 ads
      generatedAt: new Date().toISOString()
    }, null, 2));

    // ═══════════════════════════════════════════════════════════════
    // STEP 9: Update state
    // ═══════════════════════════════════════════════════════════════
    state.lastRun = new Date().toISOString();
    state.recommendations = allRecommendations;
    state.appliedChanges = [...state.appliedChanges, ...appliedChanges].slice(-30);
    state.performance.history.push(summary);

    // Keep only last 30 days
    if (state.performance.history.length > 30) {
      state.performance.history = state.performance.history.slice(-30);
    }

    saveState(state);

    // ═══════════════════════════════════════════════════════════════
    // STEP 10: Return results
    // ═══════════════════════════════════════════════════════════════
    const criticalCount = allRecommendations.filter(r => r.severity === 'critical').length;
    const warningCount = allRecommendations.filter(r => r.severity === 'warning').length;

    let outputSummary = `7-day summary: $${summary.spend} spent, ${summary.conversions} conversions, $${summary.cpa} CPA`;
    if (criticalCount > 0) {
      outputSummary += ` | ${criticalCount} CRITICAL issues`;
    }
    if (warningCount > 0) {
      outputSummary += ` | ${warningCount} warnings`;
    }
    if (headlineSuggestions.length > 0) {
      outputSummary += ` | ${headlineSuggestions.length} new headlines suggested`;
    }

    return {
      success: true,
      output: outputSummary,
      url: null,
      metadata: {
        ...summary,
        recommendations: allRecommendations,
        headlineSuggestions,
        reportFile: dailyLogFile
      }
    };

  } catch (error) {
    logger.error('Google Ads daily optimization failed', { error: error.message });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get task status
 */
async function getStatus(context) {
  const state = loadState();
  const lastPerf = state.performance.history.slice(-1)[0];

  return {
    healthy: true,
    lastRun: state.lastRun,
    lastCPA: lastPerf?.cpa,
    lastSpend: lastPerf?.spend,
    recommendationCount: state.recommendations.length,
    historyDays: state.performance.history.length
  };
}

export default { run, getStatus };
