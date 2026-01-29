#!/usr/bin/env node
/**
 * AIGNE Weekly Analytics Report v2.0
 * Focus: Organic/SEO growth + 90-day trajectory from content strategy
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import yaml from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const LIB_DIR = path.join(ROOT_DIR, 'lib');

// Dynamic imports
const { fetchAIGNEAnalytics, analyzeAIGNE, generateAIGNEHTML } = await import(path.join(LIB_DIR, 'ga4-reporter.mjs'));

// Load task configuration
const taskConfig = yaml.parse(await fs.readFile(path.join(__dirname, 'task.yaml'), 'utf8'));

const PROPERTY_ID = taskConfig.settings.propertyId;
const PROPERTY_NAME = taskConfig.settings.propertyName;
const THRESHOLDS = taskConfig.settings.thresholds;

async function sendEmailNotification(reportUrl, summary) {
  try {
    const { sendNotification } = await import(path.join(LIB_DIR, 'email-notify.mjs'));
    const subject = taskConfig.settings.notification.subject.replace('{date}', new Date().toLocaleDateString());

    await sendNotification({
      subject,
      reportUrl,
      propertyName: PROPERTY_NAME,
      summary
    });
  } catch (e) {
    console.log('Email notification skipped:', e.message);
    console.log('Report URL:', reportUrl);
  }
}

async function deployToMyVibe(htmlPath) {
  const myvibeScript = path.join(
    process.env.HOME,
    '.claude/plugins/cache/myvibe-skills/myvibe/9542dce6d194/skills/myvibe-publish/scripts/publish.mjs'
  );

  const title = `${PROPERTY_NAME} Analytics - ${new Date().toLocaleDateString()}`;
  const desc = `Weekly analytics with SEO/organic growth tracking and 90-day trajectory`;

  return new Promise((resolve, reject) => {
    const proc = spawn('node', [
      myvibeScript,
      '--file', htmlPath,
      '--title', title,
      '--desc', desc,
      '--visibility', taskConfig.settings.output.myVibeVisibility || 'private'
    ], { stdio: ['inherit', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data;
      process.stdout.write(data);
    });
    proc.stderr.on('data', (data) => {
      stderr += data;
      process.stderr.write(data);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`MyVibe deploy failed: ${stderr}`));
      } else {
        const urlMatch = stdout.match(/https:\/\/staging\.myvibe\.so\/[^\s\n]+/);
        resolve(urlMatch ? urlMatch[0] : 'https://staging.myvibe.so');
      }
    });
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log(`${PROPERTY_NAME} Weekly Analytics Report v2.0`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('Focus: Organic/SEO Growth + 90-Day Trajectory');
  console.log('='.repeat(60));

  try {
    // 1. Fetch analytics data with 90-day trend
    console.log('\n📊 Fetching GA4 data...');
    const data = await fetchAIGNEAnalytics(PROPERTY_ID, {
      currentDays: taskConfig.settings.reportPeriod.current,
      comparisonDays: taskConfig.settings.reportPeriod.comparison,
      trendDays: taskConfig.settings.reportPeriod.trend
    });

    // 2. Analyze with SEO focus
    console.log('\n🔍 Analyzing organic/search performance...');
    const analysis = analyzeAIGNE(data, THRESHOLDS);

    const m = data.metrics;
    console.log(`\n📊 Organic Performance:`);
    console.log(`   Organic Users: ${Math.round(m.organicUsers.current)} (${m.organicUsers.change >= 0 ? '+' : ''}${m.organicUsers.change.toFixed(1)}%)`);
    console.log(`   Organic % of Total: ${m.organicPercent.current.toFixed(1)}%`);
    console.log(`   90-Day Data Points: ${data.trendData.length} days`);

    console.log(`\n✅ What's Working: ${analysis.whatsWorking.length} items`);
    console.log(`🚨 Red Flags: ${analysis.redFlags.length} items`);
    console.log(`💡 Recommendations: ${analysis.recommendations.length} items`);

    // 3. Generate HTML report
    console.log('\n📝 Generating HTML report...');
    const html = generateAIGNEHTML(data, analysis);

    // 4. Save report
    const reportDir = path.join(ROOT_DIR, taskConfig.outputs.reports);
    await fs.mkdir(reportDir, { recursive: true });

    const reportDate = new Date().toISOString().split('T')[0];
    const reportPath = path.join(reportDir, `report-${reportDate}.html`);
    await fs.writeFile(reportPath, html);
    console.log(`\n💾 Report saved: ${reportPath}`);

    // 5. Deploy to MyVibe
    let reportUrl = reportPath;
    if (taskConfig.settings.output.deployToMyVibe) {
      console.log('\n🚀 Deploying to MyVibe...');
      try {
        reportUrl = await deployToMyVibe(reportPath);
        console.log(`\n🔗 Published: ${reportUrl}`);
      } catch (e) {
        console.log(`\n⚠️ MyVibe deploy failed: ${e.message}`);
      }
    }

    // 6. Send notification
    console.log('\n📧 Sending notification...');
    await sendEmailNotification(reportUrl, {
      activeUsers: Math.round(m.activeUsers.current),
      activeUsersChange: `${m.activeUsers.change >= 0 ? '+' : ''}${m.activeUsers.change.toFixed(1)}%`,
      newUsers: Math.round(m.newUsers.current),
      newUsersChange: `${m.newUsers.change >= 0 ? '+' : ''}${m.newUsers.change.toFixed(1)}%`,
      engagementRate: `${(m.engagementRate.current * 100).toFixed(1)}%`,
      organicUsers: Math.round(m.organicUsers.current),
      organicGrowth: `${m.organicUsers.change >= 0 ? '+' : ''}${m.organicUsers.change.toFixed(1)}%`
    });

    console.log('\n' + '='.repeat(60));
    console.log('✅ Report generation complete!');
    console.log(`Report URL: ${reportUrl}`);
    console.log('='.repeat(60));

    return { success: true, reportUrl, analysis };

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    return { success: false, error: error.message };
  }
}

main().then(result => {
  process.exit(result.success ? 0 : 1);
});
