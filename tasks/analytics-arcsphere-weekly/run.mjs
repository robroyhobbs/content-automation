#!/usr/bin/env node
/**
 * ArcSphere Growth Intelligence Report
 * AI-Powered Weekly Analysis for Hyper-Growth Decision Making
 *
 * Combines Google Ads + GA4 with:
 * - Week-over-week comparisons
 * - 30-day trajectory analysis
 * - Strategic recommendations
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import yaml from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const LIB_DIR = path.join(ROOT_DIR, 'lib');

// Load configurations
const taskConfig = yaml.parse(await fs.readFile(path.join(__dirname, 'task.yaml'), 'utf8'));

const CONFIG = {
  propertyId: taskConfig.settings.propertyId,
  propertyName: taskConfig.settings.propertyName,
  targetCPA: taskConfig.settings.thresholds?.conversionWarning || 2.00,
  googleAdsCustomerId: '9462287380',
  mcpServerPath: '/Users/robroyhobbs/work/google-ads-automation/mcp-server',
};

// Dynamic imports
const {
  fetchGA4Metrics,
  fetchTrajectory,
  fetchGoogleAdsData,
  analyzeMarketing,
  generateMarketingReport
} = await import(path.join(LIB_DIR, 'marketing-intelligence.mjs'));

async function deployToMyVibe(htmlPath) {
  const myvibeScript = path.join(
    process.env.HOME,
    '.claude/plugins/cache/myvibe-skills/myvibe/9542dce6d194/skills/myvibe-publish/scripts/publish.mjs'
  );

  const title = `${CONFIG.propertyName} Growth Intelligence - ${new Date().toLocaleDateString()}`;
  const desc = `AI-powered weekly growth report: Acquisition × Engagement × Retention`;

  return new Promise((resolve, reject) => {
    const proc = spawn('node', [
      myvibeScript,
      '--file', htmlPath,
      '--title', title,
      '--desc', desc,
      '--visibility', 'private'
    ], { stdio: ['inherit', 'pipe', 'pipe'] });

    let stdout = '';
    proc.stdout.on('data', (data) => { stdout += data; process.stdout.write(data); });
    proc.stderr.on('data', (data) => { process.stderr.write(data); });

    proc.on('close', (code) => {
      if (code !== 0) reject(new Error('MyVibe deploy failed'));
      else {
        const urlMatch = stdout.match(/https:\/\/staging\.myvibe\.so\/[^\s\n]+/);
        resolve(urlMatch ? urlMatch[0] : 'https://staging.myvibe.so');
      }
    });
  });
}

async function sendNotification(reportUrl, insights) {
  try {
    const { sendNotification } = await import(path.join(LIB_DIR, 'email-notify.mjs'));
    await sendNotification({
      subject: `${CONFIG.propertyName} Growth Intelligence - ${new Date().toLocaleDateString()}`,
      reportUrl,
      propertyName: CONFIG.propertyName,
      summary: {
        activeUsers: Math.round(insights.engagement.metrics.totalSessions || 0),
        activeUsersChange: insights.overall.readyToScale ? 'READY TO SCALE' : `Blocked: ${insights.overall.blockingIssue || 'unknown'}`,
        newUsers: Math.round(insights.acquisition.metrics.conversions || 0),
        newUsersChange: `CPA: $${(insights.acquisition.metrics.cpa || 0).toFixed(2)}`,
        engagementRate: `${((insights.engagement.metrics.engagementRate || 0) * 100).toFixed(1)}%`,
      }
    });
  } catch (e) {
    console.log('Email skipped:', e.message);
  }
}

async function main() {
  console.log('═'.repeat(70));
  console.log(`📊 ${CONFIG.propertyName} GROWTH INTELLIGENCE REPORT`);
  console.log('═'.repeat(70));
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Property ID: ${CONFIG.propertyId}`);
  console.log(`Google Ads Customer ID: ${CONFIG.googleAdsCustomerId}`);
  console.log('═'.repeat(70));

  // Calculate date ranges
  const today = new Date();

  // Current period (last 7 days)
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() - 1);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);

  // Previous period (7 days before that)
  const prevEndDate = new Date(startDate);
  prevEndDate.setDate(prevEndDate.getDate() - 1);
  const prevStartDate = new Date(prevEndDate);
  prevStartDate.setDate(prevStartDate.getDate() - 6);

  const dates = {
    start: startDate.toISOString().split('T')[0],
    end: endDate.toISOString().split('T')[0],
  };

  const prevDates = {
    start: prevStartDate.toISOString().split('T')[0],
    end: prevEndDate.toISOString().split('T')[0],
  };

  console.log(`\n📅 Current Period: ${dates.start} to ${dates.end}`);
  console.log(`📅 Previous Period: ${prevDates.start} to ${prevDates.end}\n`);

  try {
    // 1. Fetch current period GA4 data
    console.log('📊 Fetching current period GA4 data...');
    const ga4 = await fetchGA4Metrics(CONFIG.propertyId, dates.start, dates.end);
    console.log(`   ✓ Active Users: ${ga4.activeUsers?.toLocaleString()}`);
    console.log(`   ✓ Sessions: ${ga4.sessions?.toLocaleString()}`);
    console.log(`   ✓ Engagement Rate: ${((ga4.engagementRate || 0) * 100).toFixed(1)}%`);
    console.log(`   ✓ DAU/MAU: ${((ga4.dauPerMau || 0) * 100).toFixed(1)}%`);

    // 2. Fetch previous period GA4 data (for WoW comparison)
    console.log('\n📊 Fetching previous period GA4 data (WoW comparison)...');
    let previousPeriodGa4 = null;
    try {
      previousPeriodGa4 = await fetchGA4Metrics(CONFIG.propertyId, prevDates.start, prevDates.end);
      console.log(`   ✓ Previous Active Users: ${previousPeriodGa4.activeUsers?.toLocaleString()}`);
      console.log(`   ✓ Previous DAU/MAU: ${((previousPeriodGa4.dauPerMau || 0) * 100).toFixed(1)}%`);
    } catch (e) {
      console.log(`   ⚠️ Could not fetch previous period: ${e.message}`);
    }

    // 3. Fetch 30-day trajectory
    console.log('\n📈 Fetching 30-day trajectory...');
    let trajectory = null;
    try {
      trajectory = await fetchTrajectory(CONFIG.propertyId, 30);
      console.log(`   ✓ Trajectory: ${trajectory.trend}`);
      console.log(`   ✓ Growth Rate: ${((trajectory.growthRate || 0) * 100).toFixed(1)}%`);
    } catch (e) {
      console.log(`   ⚠️ Could not fetch trajectory: ${e.message}`);
    }

    // 4. Fetch Google Ads Data
    console.log('\n📣 Fetching Google Ads data...');
    const googleAdsReportsDir = path.join(ROOT_DIR, 'reports/google-ads/arcsphere');
    const ads = await fetchGoogleAdsData(
      CONFIG.googleAdsCustomerId,
      CONFIG.mcpServerPath,
      dates.start,
      dates.end,
      googleAdsReportsDir
    );

    if (ads.error && ads.totals.spend === 0) {
      console.log(`   ⚠️ ${ads.error}`);
      console.log('   → Continuing with GA4 data only');
    } else {
      console.log(`   ✓ Spend: $${ads.totals.spend?.toFixed(2)}`);
      console.log(`   ✓ Conversions: ${ads.totals.conversions?.toLocaleString()}`);
      console.log(`   ✓ CPA: $${ads.totals.cpa?.toFixed(2)}`);
      console.log(`   ✓ Campaigns: ${ads.campaigns?.length || 'N/A'}`);
    }

    // 5. Analyze with AI-powered insights
    console.log('\n🧠 Generating strategic insights...');
    const insights = await analyzeMarketing(ga4, ads, {
      targetCPA: CONFIG.targetCPA,
      targetEngagement: 0.50,
      targetDAUMAU: 0.10,
    }, {
      propertyId: CONFIG.propertyId,
      previousPeriodGa4,
      trajectory,
    });

    // Print executive summary
    console.log('\n' + '═'.repeat(70));
    console.log('EXECUTIVE SUMMARY');
    console.log('═'.repeat(70));
    insights.executiveSummary.forEach(s => console.log(`\n  → ${s}`));

    console.log('\n' + '─'.repeat(50));
    console.log('PILLAR ANALYSIS');
    console.log('─'.repeat(50));

    console.log(`\n📈 ACQUISITION: ${insights.acquisition.status.toUpperCase()}`);
    console.log(`   ${insights.acquisition.verdict}`);

    console.log(`\n💡 ENGAGEMENT: ${insights.engagement.status.toUpperCase()}`);
    console.log(`   ${insights.engagement.verdict}`);

    console.log(`\n🔄 RETENTION: ${insights.retention.status.toUpperCase()}`);
    console.log(`   ${insights.retention.verdict}`);

    if (trajectory) {
      console.log(`\n📈 TRAJECTORY: ${trajectory.trend.toUpperCase()}`);
      console.log(`   ${insights.trajectory.verdict}`);
    }

    console.log(`\n🎯 OVERALL: ${insights.overall.status.toUpperCase()}`);
    console.log(`   ${insights.overall.summary}`);
    console.log(`   Ready to Scale: ${insights.overall.readyToScale ? 'YES ✅' : 'NO ❌'}`);
    if (insights.overall.blockingIssue) {
      console.log(`   Blocking Issue: ${insights.overall.blockingIssue.toUpperCase()}`);
    }

    if (insights.prioritizedActions.length > 0) {
      console.log('\n📋 THIS WEEK\'S PRIORITIES:');
      insights.prioritizedActions.slice(0, 3).forEach((a, i) => {
        console.log(`   ${i + 1}. [${a.priority.toUpperCase()}] ${a.action}`);
      });
    }

    // 6. Generate Report
    console.log('\n📝 Generating HTML report...');
    const html = generateMarketingReport({
      ga4,
      ads,
      insights,
      config: CONFIG,
      dates,
      trajectory,
      previousPeriodGa4,
    });

    // 7. Save Report
    const reportDir = path.join(ROOT_DIR, 'reports/marketing/arcsphere');
    await fs.mkdir(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `report-${dates.end}.html`);
    await fs.writeFile(reportPath, html);
    console.log(`\n💾 Report saved: ${reportPath}`);

    // 8. Deploy to MyVibe
    console.log('\n🚀 Deploying to MyVibe...');
    let reportUrl = reportPath;
    try {
      reportUrl = await deployToMyVibe(reportPath);
      console.log(`\n🔗 Published: ${reportUrl}`);
    } catch (e) {
      console.log(`\n⚠️ MyVibe deploy failed: ${e.message}`);
    }

    // 9. Send Notification
    console.log('\n📧 Sending notification...');
    await sendNotification(reportUrl, insights);

    console.log('\n' + '═'.repeat(70));
    console.log('✅ GROWTH INTELLIGENCE REPORT COMPLETE');
    console.log(`🔗 ${reportUrl}`);
    console.log('═'.repeat(70));

    return { success: true, reportUrl, insights };

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    return { success: false, error: error.message };
  }
}

main().then(result => process.exit(result.success ? 0 : 1));
