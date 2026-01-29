/**
 * Google Ads Weekly Review Runner
 *
 * Generates comprehensive weekly performance report with strategy recommendations.
 * Outputs a markdown file for easy review and sharing.
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const REPORTS_DIR = join(__dirname, '..', '..', 'reports', 'google-ads');
const STATE_FILE = join(DATA_DIR, 'google-ads-weekly-state.json');

/**
 * Load state from previous runs
 */
function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (error) {
    // Ignore
  }
  return {
    lastRun: null,
    weeklyHistory: [],
    strategyChanges: []
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
 * Parse table data from MCP response
 */
function parseTableData(rawData) {
  const lines = rawData.split('\n').filter(line => line.trim());
  const results = [];

  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(' | ') && !lines[i].includes('---')) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) return results;

  const headers = lines[headerIndex].split('|').map(h => h.trim());

  for (let i = headerIndex + 2; i < lines.length; i++) {
    if (lines[i].includes('---')) continue;
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
 * Load daily logs from this week
 */
function loadDailyLogs(daysBack = 7) {
  const logs = [];
  const now = new Date();

  for (let i = 0; i < daysBack; i++) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];
    const logFile = join(REPORTS_DIR, `daily-${dateStr}.json`);

    if (existsSync(logFile)) {
      try {
        logs.push(JSON.parse(readFileSync(logFile, 'utf8')));
      } catch (error) {
        // Ignore malformed files
      }
    }
  }

  return logs;
}

/**
 * Calculate week-over-week change
 */
function calculateWoWChange(current, previous) {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous * 100).toFixed(1);
}

/**
 * Generate strategy recommendations based on performance
 */
function generateStrategyRecommendations(summary, goals, dailyLogs) {
  const recommendations = [];

  // CPA Analysis
  if (summary.cpa > goals.targetCPA * 1.5) {
    recommendations.push({
      priority: 'HIGH',
      category: 'Cost Efficiency',
      issue: `CPA ($${summary.cpa}) is ${((summary.cpa / goals.targetCPA - 1) * 100).toFixed(0)}% above target ($${goals.targetCPA})`,
      suggestions: [
        'Review and pause keywords with CPA > $' + (goals.targetCPA * 2),
        'Increase bid on high-converting keywords',
        'Test new audience segments with lower CPCs',
        'Consider shifting budget to better-performing campaigns'
      ]
    });
  } else if (summary.cpa < goals.targetCPA * 0.7) {
    recommendations.push({
      priority: 'OPPORTUNITY',
      category: 'Scale Potential',
      issue: `CPA ($${summary.cpa}) is significantly below target - room to scale`,
      suggestions: [
        'Consider increasing daily budget by 20-30%',
        'Expand to new keyword groups',
        'Test broader match types on top performers'
      ]
    });
  }

  // Conversion Volume
  if (summary.conversions < goals.minConversions * 0.5) {
    recommendations.push({
      priority: 'HIGH',
      category: 'Volume',
      issue: `Only ${summary.conversions} conversions this week (target: ${goals.minConversions})`,
      suggestions: [
        'Increase budget if CPA is within target',
        'Expand keyword targeting',
        'Review ad scheduling - are we missing peak hours?',
        'Check landing page conversion rate'
      ]
    });
  }

  // CTR Analysis
  if (summary.ctr < 1.0) {
    recommendations.push({
      priority: 'MEDIUM',
      category: 'Ad Relevance',
      issue: `Low CTR (${summary.ctr}%) indicates ad messaging may not resonate`,
      suggestions: [
        'Test new headlines with different value propositions',
        'Add more specific callout extensions',
        'Review search terms and add negative keywords',
        'Ensure ad copy matches landing page message'
      ]
    });
  }

  // Daily consistency check
  const dailySpends = dailyLogs.map(l => parseFloat(l.summary?.spend || 0));
  const avgDailySpend = dailySpends.reduce((a, b) => a + b, 0) / dailySpends.length;
  const spendVariance = Math.max(...dailySpends) - Math.min(...dailySpends);

  if (spendVariance > avgDailySpend * 0.5) {
    recommendations.push({
      priority: 'LOW',
      category: 'Budget Consistency',
      issue: 'High variance in daily spend - budget may be limiting delivery',
      suggestions: [
        'Review campaign budget allocation',
        'Check for bid strategy issues',
        'Ensure campaigns are not becoming "limited by budget"'
      ]
    });
  }

  // Recurring issues from daily logs
  const allRecs = dailyLogs.flatMap(l => l.recommendations || []);
  const recCounts = {};
  for (const rec of allRecs) {
    recCounts[rec.type] = (recCounts[rec.type] || 0) + 1;
  }

  const recurringIssues = Object.entries(recCounts)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  if (recurringIssues.length > 0) {
    recommendations.push({
      priority: 'MEDIUM',
      category: 'Recurring Issues',
      issue: 'These issues appeared multiple times this week:',
      suggestions: recurringIssues.map(([type, count]) =>
        `${type}: ${count} occurrences - needs systematic fix`
      )
    });
  }

  return recommendations;
}

/**
 * Generate markdown report
 */
function generateMarkdownReport(data) {
  const {
    weekStart,
    weekEnd,
    summary,
    goals,
    recommendations,
    campaignBreakdown,
    dailyLogs,
    previousWeek
  } = data;

  let md = `# MyVibe Google Ads Weekly Report

**Period:** ${weekStart} to ${weekEnd}
**Generated:** ${new Date().toISOString().split('T')[0]}

---

## Executive Summary

| Metric | This Week | Target | vs Target | vs Last Week |
|--------|-----------|--------|-----------|--------------|
| Spend | $${summary.spend} | $${goals.weeklyBudget} | ${summary.spend <= goals.weeklyBudget ? '✅' : '⚠️'} | ${previousWeek ? calculateWoWChange(summary.spend, previousWeek.spend) + '%' : 'N/A'} |
| Conversions | ${summary.conversions} | ${goals.minConversions} | ${summary.conversions >= goals.minConversions * 0.8 ? '✅' : '❌'} | ${previousWeek ? calculateWoWChange(summary.conversions, previousWeek.conversions) + '%' : 'N/A'} |
| CPA | $${summary.cpa} | $${goals.targetCPA} | ${summary.cpa <= goals.targetCPA ? '✅' : '❌'} | ${previousWeek ? calculateWoWChange(summary.cpa, previousWeek.cpa) + '%' : 'N/A'} |
| CTR | ${summary.ctr}% | >1% | ${summary.ctr >= 1.0 ? '✅' : '⚠️'} | ${previousWeek ? calculateWoWChange(summary.ctr, previousWeek.ctr) + '%' : 'N/A'} |
| Clicks | ${summary.clicks} | - | - | ${previousWeek ? calculateWoWChange(summary.clicks, previousWeek.clicks) + '%' : 'N/A'} |
| Impressions | ${summary.impressions.toLocaleString()} | - | - | ${previousWeek ? calculateWoWChange(summary.impressions, previousWeek.impressions) + '%' : 'N/A'} |

### Goal Progress

`;

  const cpaStatus = summary.cpa <= goals.targetCPA ? '🟢 ON TRACK' : summary.cpa <= goals.targetCPA * 1.5 ? '🟡 NEEDS ATTENTION' : '🔴 OFF TRACK';
  const convStatus = summary.conversions >= goals.minConversions * 0.8 ? '🟢 ON TRACK' : summary.conversions >= goals.minConversions * 0.5 ? '🟡 NEEDS ATTENTION' : '🔴 OFF TRACK';

  md += `- **CPA Goal ($${goals.targetCPA}):** ${cpaStatus} - Current: $${summary.cpa}
- **Weekly Conversion Goal (${goals.minConversions}):** ${convStatus} - Current: ${summary.conversions}

---

## Strategic Recommendations

`;

  const priorityOrder = { 'HIGH': 1, 'OPPORTUNITY': 2, 'MEDIUM': 3, 'LOW': 4 };
  const sortedRecs = recommendations.sort((a, b) =>
    (priorityOrder[a.priority] || 5) - (priorityOrder[b.priority] || 5)
  );

  for (const rec of sortedRecs) {
    const priorityEmoji = {
      'HIGH': '🔴',
      'OPPORTUNITY': '🟢',
      'MEDIUM': '🟡',
      'LOW': '⚪'
    }[rec.priority] || '⚪';

    md += `### ${priorityEmoji} ${rec.category}

**Issue:** ${rec.issue}

**Recommended Actions:**
`;
    for (const suggestion of rec.suggestions) {
      md += `- ${suggestion}\n`;
    }
    md += '\n';
  }

  md += `---

## Campaign Performance Breakdown

`;

  if (campaignBreakdown.length > 0) {
    md += `| Campaign | Spend | Conversions | CPA | CTR | Status |
|----------|-------|-------------|-----|-----|--------|
`;
    for (const camp of campaignBreakdown) {
      const status = camp.cpa <= goals.targetCPA ? '✅' : camp.cpa <= goals.targetCPA * 1.5 ? '⚠️' : '❌';
      md += `| ${camp.name} | $${camp.spend} | ${camp.conversions} | $${camp.cpa} | ${camp.ctr}% | ${status} |\n`;
    }
  } else {
    md += `*No campaign data available for this period.*\n`;
  }

  md += `
---

## Daily Trend

`;

  if (dailyLogs.length > 0) {
    md += `| Date | Spend | Conversions | CPA | Issues |
|------|-------|-------------|-----|--------|
`;
    for (const log of dailyLogs.reverse()) {
      const s = log.summary || {};
      const issueCount = log.recommendations?.length || 0;
      const criticalCount = log.recommendations?.filter(r => r.severity === 'critical').length || 0;
      md += `| ${s.date} | $${s.spend || '0'} | ${s.conversions || 0} | $${s.cpa || 'N/A'} | ${criticalCount > 0 ? '🔴 ' + criticalCount : issueCount > 0 ? '🟡 ' + issueCount : '✅'} |\n`;
    }
  }

  md += `
---

## Headline Performance

*Review top-performing and underperforming headlines from this week.*

### Suggested New Headlines to Test

Based on MyVibe's "share-first" messaging strategy:

1. **"Share Your AI Creations"** - Emphasizes the core value prop
2. **"Live in Seconds"** - Speed-focused for impatient creators
3. **"No DevOps Required"** - Removes friction fear
4. **"Your Vibes, Live Now"** - Brand-aligned, action-oriented
5. **"From Chat to Live"** - Workflow simplification

---

## Next Week Focus

Based on this week's analysis:

`;

  if (summary.cpa > goals.targetCPA) {
    md += `1. **Priority: Reduce CPA** - Focus on pausing low-converting ads and keywords
2. **Test new headlines** - Current CTR suggests messaging may need refresh
3. **Review landing page** - Ensure conversion path is optimized
`;
  } else if (summary.conversions < goals.minConversions * 0.8) {
    md += `1. **Priority: Increase Volume** - CPA is healthy, scale budget by 20%
2. **Expand keywords** - Add more long-tail variations
3. **Test Display campaigns** - Reach new audience segments
`;
  } else {
    md += `1. **Maintain momentum** - Current performance is on track
2. **Test incrementally** - Small optimizations to improve further
3. **Document what's working** - Create playbook for scaling
`;
  }

  md += `
---

*Report generated by Content Automation Hub*
*Google Ads data retrieved via MCP server*
`;

  return md;
}

/**
 * Main task execution
 */
async function run(context) {
  const { config, logger } = context;
  const { settings } = config;

  logger.info('Starting Google Ads weekly review');

  const state = loadState();
  const today = new Date();
  const weekEnd = today.toISOString().split('T')[0];
  const weekStart = new Date(today - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  try {
    // Get customer ID
    const customerId = settings.customerId || process.env.GOOGLE_ADS_CUSTOMER_ID;
    if (!customerId) {
      return {
        success: false,
        error: 'No Google Ads customer ID configured'
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Load daily logs from this week
    // ═══════════════════════════════════════════════════════════════
    logger.info('Loading daily logs');
    const dailyLogs = loadDailyLogs(settings.reviewPeriod);
    logger.info(`Found ${dailyLogs.length} daily logs`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Get campaign performance
    // ═══════════════════════════════════════════════════════════════
    logger.info('Fetching 7-day campaign performance');

    let campaignData = '';
    let campaigns = [];

    try {
      campaignData = await callMCPTool('get_campaign_performance', {
        customer_id: customerId,
        days: 7
      }, settings);
      campaigns = parseTableData(campaignData);
    } catch (error) {
      logger.warn('Failed to get campaign data', { error: error.message });
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Calculate summary metrics
    // ═══════════════════════════════════════════════════════════════
    let totalSpend = 0;
    let totalConversions = 0;
    let totalClicks = 0;
    let totalImpressions = 0;

    const campaignBreakdown = [];

    for (const camp of campaigns) {
      const spend = parseInt(camp['metrics.cost_micros'] || 0) / 1_000_000;
      const conversions = parseFloat(camp['metrics.conversions'] || 0);
      const clicks = parseInt(camp['metrics.clicks'] || 0);
      const impressions = parseInt(camp['metrics.impressions'] || 0);

      totalSpend += spend;
      totalConversions += conversions;
      totalClicks += clicks;
      totalImpressions += impressions;

      if (impressions > 0) {
        campaignBreakdown.push({
          name: camp['campaign.name'] || 'Unknown',
          spend: spend.toFixed(2),
          conversions: conversions.toFixed(1),
          cpa: conversions > 0 ? (spend / conversions).toFixed(2) : 'N/A',
          ctr: (clicks / impressions * 100).toFixed(2)
        });
      }
    }

    const summary = {
      spend: totalSpend.toFixed(2),
      conversions: totalConversions.toFixed(1),
      cpa: totalConversions > 0 ? (totalSpend / totalConversions).toFixed(2) : 'N/A',
      ctr: totalImpressions > 0 ? (totalClicks / totalImpressions * 100).toFixed(2) : '0.00',
      clicks: totalClicks,
      impressions: totalImpressions
    };

    logger.info('Weekly summary', summary);

    // ═══════════════════════════════════════════════════════════════
    // STEP 4: Load previous week for comparison
    // ═══════════════════════════════════════════════════════════════
    const previousWeek = state.weeklyHistory.slice(-1)[0] || null;

    // ═══════════════════════════════════════════════════════════════
    // STEP 5: Generate strategic recommendations
    // ═══════════════════════════════════════════════════════════════
    logger.info('Generating recommendations');

    const recommendations = generateStrategyRecommendations(
      {
        ...summary,
        cpa: parseFloat(summary.cpa) || 0,
        ctr: parseFloat(summary.ctr) || 0,
        conversions: parseFloat(summary.conversions) || 0,
        spend: parseFloat(summary.spend) || 0
      },
      settings.goals,
      dailyLogs
    );

    // ═══════════════════════════════════════════════════════════════
    // STEP 6: Generate markdown report
    // ═══════════════════════════════════════════════════════════════
    logger.info('Generating report');

    const report = generateMarkdownReport({
      weekStart,
      weekEnd,
      summary,
      goals: settings.goals,
      recommendations,
      campaignBreakdown,
      dailyLogs,
      previousWeek
    });

    // Save report
    if (!existsSync(REPORTS_DIR)) {
      mkdirSync(REPORTS_DIR, { recursive: true });
    }

    const reportFile = join(REPORTS_DIR, `weekly-${weekEnd}.md`);
    writeFileSync(reportFile, report);
    logger.info(`Report saved: ${reportFile}`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 7: Update state
    // ═══════════════════════════════════════════════════════════════
    state.lastRun = new Date().toISOString();
    state.weeklyHistory.push({
      weekEnd,
      ...summary,
      recommendationCount: recommendations.length
    });

    // Keep only last 12 weeks
    if (state.weeklyHistory.length > 12) {
      state.weeklyHistory = state.weeklyHistory.slice(-12);
    }

    saveState(state);

    // ═══════════════════════════════════════════════════════════════
    // STEP 8: Return results
    // ═══════════════════════════════════════════════════════════════
    const highPriorityCount = recommendations.filter(r => r.priority === 'HIGH').length;

    let outputSummary = `Weekly Report: $${summary.spend} spent, ${summary.conversions} conversions, $${summary.cpa} CPA`;
    if (highPriorityCount > 0) {
      outputSummary += ` | ${highPriorityCount} HIGH priority recommendations`;
    }

    return {
      success: true,
      output: outputSummary,
      url: reportFile,
      metadata: {
        weekStart,
        weekEnd,
        ...summary,
        recommendationCount: recommendations.length,
        highPriorityCount,
        reportFile
      }
    };

  } catch (error) {
    logger.error('Weekly review failed', { error: error.message });
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

  return {
    healthy: true,
    lastRun: state.lastRun,
    weeksAnalyzed: state.weeklyHistory.length
  };
}

export default { run, getStatus };
