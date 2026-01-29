/**
 * GA4 Analytics Reporter v2.0
 * Enhanced with:
 * - 90-day trend views
 * - Organic/search traffic analysis
 * - Shift/inflection point detection
 * - Custom baseline dates
 * - 3-pillar analysis (conversion, engagement, retention)
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PIPX_PYTHON = path.join(process.env.HOME, '.local/pipx/venvs/analytics-mcp/bin/python');

/**
 * Execute Python script for GA4 data fetching
 */
async function runPythonGA4(propertyId, startDate, endDate, metrics, dimensions) {
  const script = `
import json
import sys
from datetime import datetime, timedelta
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    RunReportRequest,
    DateRange,
    Dimension,
    Metric,
    OrderBy,
)

def fetch_ga4_data(property_id, start_date, end_date, metrics, dimensions):
    client = BetaAnalyticsDataClient()

    order_bys = []
    if "date" in dimensions:
        order_bys.append(OrderBy(dimension=OrderBy.DimensionOrderBy(dimension_name="date")))

    request = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
        metrics=[Metric(name=m) for m in metrics],
        dimensions=[Dimension(name=d) for d in dimensions] if dimensions else [],
        order_bys=order_bys,
        limit=10000,
    )

    response = client.run_report(request)

    result = {
        "rows": [],
        "totals": {},
        "row_count": response.row_count,
    }

    # Initialize totals for summing
    metric_names = [m.name for m in response.metric_headers]
    for name in metric_names:
        result["totals"][name] = 0

    # Process rows and sum totals
    for row in response.rows:
        row_data = {}
        for i, dim in enumerate(response.dimension_headers):
            row_data[dim.name] = row.dimension_values[i].value
        for i, met in enumerate(response.metric_headers):
            value = float(row.metric_values[i].value) if row.metric_values[i].value else 0
            row_data[met.name] = value
            result["totals"][met.name] += value
        result["rows"].append(row_data)

    return result

# Parse arguments
property_id = sys.argv[1]
start_date = sys.argv[2]
end_date = sys.argv[3]
metrics = json.loads(sys.argv[4])
dimensions = json.loads(sys.argv[5]) if len(sys.argv) > 5 else []

data = fetch_ga4_data(property_id, start_date, end_date, metrics, dimensions)
print(json.dumps(data))
`;

  return new Promise((resolve, reject) => {
    const proc = spawn(PIPX_PYTHON, [
      '-c', script,
      propertyId,
      startDate,
      endDate,
      JSON.stringify(metrics),
      JSON.stringify(dimensions)
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python script failed: ${stderr}`));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error(`Failed to parse output: ${stdout}`));
        }
      }
    });
  });
}

/**
 * Calculate date ranges
 */
function getDateRanges(currentDays = 7, comparisonDays = 7, trendDays = 90, baselineDate = null) {
  const format = (d) => d.toISOString().split('T')[0];

  const today = new Date();
  const currentEnd = new Date(today);
  currentEnd.setDate(currentEnd.getDate() - 1); // Yesterday

  const currentStart = new Date(currentEnd);
  currentStart.setDate(currentStart.getDate() - currentDays + 1);

  const comparisonEnd = new Date(currentStart);
  comparisonEnd.setDate(comparisonEnd.getDate() - 1);

  const comparisonStart = new Date(comparisonEnd);
  comparisonStart.setDate(comparisonStart.getDate() - comparisonDays + 1);

  const trendStart = new Date(currentEnd);
  trendStart.setDate(trendStart.getDate() - trendDays + 1);

  // Custom baseline date for historical analysis
  let baseline = null;
  if (baselineDate) {
    baseline = {
      start: baselineDate,
      end: format(currentEnd)
    };
  }

  return {
    current: { start: format(currentStart), end: format(currentEnd) },
    comparison: { start: format(comparisonStart), end: format(comparisonEnd) },
    trend: { start: format(trendStart), end: format(currentEnd) },
    baseline
  };
}

/**
 * Calculate percentage change
 */
function calcChange(current, previous) {
  if (!previous || previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

/**
 * Detect significant shifts in time series data
 */
function detectShifts(dailyData, metric, threshold = 20) {
  const shifts = [];
  const values = dailyData.map(d => ({ date: d.date, value: d[metric] || 0 }));

  // Calculate 3-day moving average to smooth noise
  for (let i = 3; i < values.length; i++) {
    const prevAvg = (values[i-3].value + values[i-2].value + values[i-1].value) / 3;
    const currAvg = (values[i-2].value + values[i-1].value + values[i].value) / 3;

    if (prevAvg > 0) {
      const change = ((currAvg - prevAvg) / prevAvg) * 100;
      if (Math.abs(change) >= threshold) {
        shifts.push({
          date: values[i].date,
          change: change,
          direction: change > 0 ? 'increase' : 'decrease',
          from: Math.round(prevAvg),
          to: Math.round(currAvg)
        });
      }
    }
  }

  return shifts;
}

/**
 * Fetch comprehensive analytics data for AIGNE (with organic/search focus)
 */
export async function fetchAIGNEAnalytics(propertyId, config = {}) {
  const { currentDays = 7, comparisonDays = 7, trendDays = 90 } = config;
  const dates = getDateRanges(currentDays, comparisonDays, trendDays);

  // Core metrics (batch 1)
  const coreMetrics = [
    'activeUsers', 'newUsers', 'sessions', 'screenPageViews',
    'engagedSessions', 'engagementRate', 'sessionsPerUser',
    'screenPageViewsPerSession', 'bounceRate', 'userEngagementDuration'
  ];

  // Retention metrics (batch 2)
  const retentionMetrics = ['dauPerMau', 'dauPerWau', 'wauPerMau'];

  console.log(`Fetching current period: ${dates.current.start} to ${dates.current.end}`);

  // Current period - core metrics by date
  const currentData = await runPythonGA4(propertyId, dates.current.start, dates.current.end, coreMetrics, ['date']);

  // Current period - retention
  const currentRetention = await runPythonGA4(propertyId, dates.current.start, dates.current.end, retentionMetrics, []);

  // Comparison period
  console.log(`Fetching comparison period: ${dates.comparison.start} to ${dates.comparison.end}`);
  const comparisonData = await runPythonGA4(propertyId, dates.comparison.start, dates.comparison.end, coreMetrics, ['date']);
  const comparisonRetention = await runPythonGA4(propertyId, dates.comparison.start, dates.comparison.end, retentionMetrics, []);

  // 90-day trend data
  console.log(`Fetching 90-day trend: ${dates.trend.start} to ${dates.trend.end}`);
  const trendData = await runPythonGA4(propertyId, dates.trend.start, dates.trend.end,
    ['activeUsers', 'sessions', 'screenPageViews', 'newUsers'], ['date']);

  // Traffic source breakdown (current period)
  console.log('Fetching traffic sources...');
  const sourceData = await runPythonGA4(propertyId, dates.current.start, dates.current.end,
    ['activeUsers', 'sessions', 'engagementRate'], ['sessionDefaultChannelGroup']);

  // Organic search specific
  const organicData = await runPythonGA4(propertyId, dates.current.start, dates.current.end,
    ['activeUsers', 'sessions', 'screenPageViews'], ['sessionSource', 'sessionMedium']);

  // Previous period organic for comparison
  const organicCompare = await runPythonGA4(propertyId, dates.comparison.start, dates.comparison.end,
    ['activeUsers', 'sessions', 'screenPageViews'], ['sessionSource', 'sessionMedium']);

  // Top landing pages
  const landingPages = await runPythonGA4(propertyId, dates.current.start, dates.current.end,
    ['sessions', 'engagementRate', 'bounceRate'], ['landingPage']);

  // Calculate organic traffic
  const organicRows = organicData.rows.filter(r =>
    r.sessionMedium === 'organic' || r.sessionSource === 'google' && r.sessionMedium === 'organic'
  );
  const organicTotals = organicRows.reduce((acc, r) => {
    acc.users += r.activeUsers;
    acc.sessions += r.sessions;
    acc.views += r.screenPageViews;
    return acc;
  }, { users: 0, sessions: 0, views: 0 });

  const organicCompareRows = organicCompare.rows.filter(r =>
    r.sessionMedium === 'organic' || r.sessionSource === 'google' && r.sessionMedium === 'organic'
  );
  const organicCompareTotals = organicCompareRows.reduce((acc, r) => {
    acc.users += r.activeUsers;
    acc.sessions += r.sessions;
    acc.views += r.screenPageViews;
    return acc;
  }, { users: 0, sessions: 0, views: 0 });

  // Merge totals
  const currentTotals = { ...currentData.totals, ...currentRetention.totals };
  const comparisonTotals = { ...comparisonData.totals, ...comparisonRetention.totals };

  // Calculate metrics with changes
  const metrics = {};
  for (const metric of [...coreMetrics, ...retentionMetrics]) {
    const current = currentTotals[metric] || 0;
    const previous = comparisonTotals[metric] || 0;
    metrics[metric] = {
      current,
      previous,
      change: calcChange(current, previous),
      trend: current >= previous ? 'up' : 'down'
    };
  }

  // Add organic-specific metrics
  metrics.organicUsers = {
    current: organicTotals.users,
    previous: organicCompareTotals.users,
    change: calcChange(organicTotals.users, organicCompareTotals.users),
    trend: organicTotals.users >= organicCompareTotals.users ? 'up' : 'down'
  };
  metrics.organicSessions = {
    current: organicTotals.sessions,
    previous: organicCompareTotals.sessions,
    change: calcChange(organicTotals.sessions, organicCompareTotals.sessions),
    trend: organicTotals.sessions >= organicCompareTotals.sessions ? 'up' : 'down'
  };

  // Calculate organic percentage of total
  metrics.organicPercent = {
    current: currentTotals.sessions > 0 ? (organicTotals.sessions / currentTotals.sessions) * 100 : 0,
    previous: comparisonTotals.sessions > 0 ? (organicCompareTotals.sessions / comparisonTotals.sessions) * 100 : 0
  };
  metrics.organicPercent.change = metrics.organicPercent.current - metrics.organicPercent.previous;

  return {
    propertyId,
    propertyName: 'AIGNE',
    dates,
    metrics,
    dailyData: currentData.rows,
    comparisonDailyData: comparisonData.rows,
    trendData: trendData.rows,
    sourceBreakdown: sourceData.rows,
    organicData: organicRows,
    landingPages: landingPages.rows.sort((a, b) => b.sessions - a.sessions).slice(0, 10),
    generatedAt: new Date().toISOString()
  };
}

/**
 * Fetch comprehensive analytics data for ArcSphere (with 3-pillar focus)
 */
export async function fetchArcSphereAnalytics(propertyId, config = {}) {
  const { currentDays = 7, comparisonDays = 7, baselineDate = '2025-12-23' } = config;
  const dates = getDateRanges(currentDays, comparisonDays, 90, baselineDate);

  // Update baseline dates
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() - 1);
  dates.baseline = {
    start: baselineDate,
    end: endDate.toISOString().split('T')[0]
  };

  // Conversion metrics
  const conversionMetrics = ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'eventCount'];

  // Engagement metrics
  const engagementMetrics = ['engagedSessions', 'engagementRate', 'sessionsPerUser',
    'screenPageViewsPerSession', 'userEngagementDuration'];

  // Retention metrics
  const retentionMetrics = ['dauPerMau', 'dauPerWau', 'wauPerMau'];

  console.log(`Fetching current period: ${dates.current.start} to ${dates.current.end}`);

  // Current period data
  const currentConversion = await runPythonGA4(propertyId, dates.current.start, dates.current.end, conversionMetrics, ['date']);
  const currentEngagement = await runPythonGA4(propertyId, dates.current.start, dates.current.end, engagementMetrics, ['date']);
  const currentRetention = await runPythonGA4(propertyId, dates.current.start, dates.current.end, retentionMetrics, []);

  // Comparison period
  console.log(`Fetching comparison period: ${dates.comparison.start} to ${dates.comparison.end}`);
  const compConversion = await runPythonGA4(propertyId, dates.comparison.start, dates.comparison.end, conversionMetrics, ['date']);
  const compEngagement = await runPythonGA4(propertyId, dates.comparison.start, dates.comparison.end, engagementMetrics, ['date']);
  const compRetention = await runPythonGA4(propertyId, dates.comparison.start, dates.comparison.end, retentionMetrics, []);

  // Full baseline period (since Dec 23)
  console.log(`Fetching baseline trend: ${dates.baseline.start} to ${dates.baseline.end}`);
  const baselineTrend = await runPythonGA4(propertyId, dates.baseline.start, dates.baseline.end,
    ['activeUsers', 'newUsers', 'sessions', 'engagedSessions'], ['date']);

  // Platform breakdown
  const platformData = await runPythonGA4(propertyId, dates.current.start, dates.current.end,
    ['activeUsers', 'sessions', 'engagementRate'], ['platform']);

  // Traffic source
  const sourceData = await runPythonGA4(propertyId, dates.current.start, dates.current.end,
    ['activeUsers', 'sessions'], ['sessionDefaultChannelGroup']);

  // Merge daily data
  const dailyData = currentConversion.rows.map((row, i) => ({
    ...row,
    ...(currentEngagement.rows[i] || {})
  }));

  // Merge totals
  const currentTotals = {
    ...currentConversion.totals,
    ...currentEngagement.totals,
    ...currentRetention.totals
  };
  const compTotals = {
    ...compConversion.totals,
    ...compEngagement.totals,
    ...compRetention.totals
  };

  // Calculate all metrics
  const allMetrics = [...conversionMetrics, ...engagementMetrics, ...retentionMetrics];
  const metrics = {};
  for (const metric of allMetrics) {
    const current = currentTotals[metric] || 0;
    const previous = compTotals[metric] || 0;
    metrics[metric] = {
      current,
      previous,
      change: calcChange(current, previous),
      trend: current >= previous ? 'up' : 'down'
    };
  }

  // Detect shifts in baseline data
  console.log('Detecting significant shifts...');
  const userShifts = detectShifts(baselineTrend.rows, 'activeUsers', 25);
  const sessionShifts = detectShifts(baselineTrend.rows, 'sessions', 25);

  // Calculate 3 pillars health
  const pillars = {
    conversion: {
      score: metrics.newUsers.change >= 0 ? 'healthy' : 'declining',
      metric: metrics.newUsers,
      description: 'New user acquisition'
    },
    engagement: {
      score: metrics.engagementRate.current >= 0.4 ? 'healthy' : 'needs_attention',
      metric: metrics.engagementRate,
      description: 'User engagement with app'
    },
    retention: {
      score: metrics.dauPerMau.current >= 0.1 ? 'healthy' : 'critical',
      metric: metrics.dauPerMau,
      description: 'Users returning to app'
    }
  };

  // Overall health
  const healthyCount = Object.values(pillars).filter(p => p.score === 'healthy').length;
  pillars.overall = healthyCount === 3 ? 'winning' : healthyCount >= 2 ? 'at_risk' : 'losing';

  return {
    propertyId,
    propertyName: 'ArcSphere',
    dates,
    metrics,
    pillars,
    dailyData,
    baselineTrend: baselineTrend.rows,
    shifts: { users: userShifts, sessions: sessionShifts },
    platformBreakdown: platformData.rows,
    sourceBreakdown: sourceData.rows,
    annotations: [
      { date: '20251223', event: 'Google Ads Launch', type: 'positive' },
      { date: '20260120', event: 'Reduced Ad Spend', type: 'negative' }
    ],
    generatedAt: new Date().toISOString()
  };
}

/**
 * Analyze AIGNE data with SEO focus
 */
export function analyzeAIGNE(data, thresholds = {}) {
  const { significantChange = 15, organicGrowthTarget = 10 } = thresholds;
  const whatsWorking = [];
  const redFlags = [];
  const recommendations = [];
  const m = data.metrics;

  // Check organic growth
  if (m.organicUsers.change >= organicGrowthTarget) {
    whatsWorking.push({
      metric: 'Organic Traffic',
      message: `Growing ${m.organicUsers.change.toFixed(1)}% week-over-week`,
      value: m.organicUsers.current,
      insight: 'Content strategy is driving SEO results'
    });
  } else if (m.organicUsers.change < 0) {
    redFlags.push({
      metric: 'Organic Traffic',
      message: `Declining ${Math.abs(m.organicUsers.change).toFixed(1)}%`,
      severity: 'medium'
    });
    recommendations.push('Review recent content quality and keyword targeting');
  }

  // Check organic percentage
  if (m.organicPercent.current > 30) {
    whatsWorking.push({
      metric: 'Organic Share',
      message: `${m.organicPercent.current.toFixed(1)}% of traffic is organic`,
      insight: 'Strong SEO foundation'
    });
  }

  // Overall traffic growth
  if (m.activeUsers.change > significantChange) {
    whatsWorking.push({
      metric: 'Total Users',
      message: `Up ${m.activeUsers.change.toFixed(1)}% week-over-week`,
      value: m.activeUsers.current
    });
  } else if (m.activeUsers.change < -significantChange) {
    redFlags.push({
      metric: 'Total Users',
      message: `Down ${Math.abs(m.activeUsers.change).toFixed(1)}%`,
      severity: 'high'
    });
  }

  // Engagement
  const engagementRate = m.engagementRate.current * 100;
  if (engagementRate > 50) {
    whatsWorking.push({
      metric: 'Engagement',
      message: `Strong at ${engagementRate.toFixed(1)}%`
    });
  } else if (engagementRate < 30) {
    redFlags.push({
      metric: 'Engagement',
      message: `Low at ${engagementRate.toFixed(1)}%`,
      severity: 'medium'
    });
    recommendations.push('Improve content relevance and page load times');
  }

  // 90-day trajectory
  const trendData = data.trendData;
  if (trendData.length >= 14) {
    const firstWeek = trendData.slice(0, 7).reduce((sum, d) => sum + d.activeUsers, 0);
    const lastWeek = trendData.slice(-7).reduce((sum, d) => sum + d.activeUsers, 0);
    const trajectoryChange = calcChange(lastWeek, firstWeek);

    if (trajectoryChange > 20) {
      whatsWorking.push({
        metric: '90-Day Trajectory',
        message: `Traffic up ${trajectoryChange.toFixed(0)}% over 90 days`,
        insight: 'Consistent growth trend'
      });
    }
  }

  if (redFlags.length === 0) {
    recommendations.push('Continue current content strategy - metrics are healthy');
    recommendations.push('Consider increasing content velocity to accelerate organic growth');
  }

  return { whatsWorking, redFlags, recommendations };
}

/**
 * Analyze ArcSphere data with 3-pillar focus
 */
export function analyzeArcSphere(data, thresholds = {}) {
  const whatsWorking = [];
  const redFlags = [];
  const recommendations = [];
  const { pillars, metrics: m, shifts } = data;

  // 3 Pillars Analysis
  if (pillars.conversion.score === 'healthy') {
    whatsWorking.push({
      metric: 'Conversion',
      message: `New users: ${Math.round(m.newUsers.current)} (${m.newUsers.change >= 0 ? '+' : ''}${m.newUsers.change.toFixed(1)}%)`,
      pillar: true
    });
  } else {
    redFlags.push({
      metric: 'Conversion',
      message: `New users declining: ${m.newUsers.change.toFixed(1)}%`,
      severity: 'high',
      pillar: true
    });
    recommendations.push('CONVERSION: Review acquisition channels - consider increasing ad spend or improving store listing');
  }

  if (pillars.engagement.score === 'healthy') {
    whatsWorking.push({
      metric: 'Engagement',
      message: `Engagement rate: ${(m.engagementRate.current * 100).toFixed(1)}%`,
      pillar: true
    });
  } else {
    redFlags.push({
      metric: 'Engagement',
      message: `Engagement below target: ${(m.engagementRate.current * 100).toFixed(1)}%`,
      severity: 'high',
      pillar: true
    });
    recommendations.push('ENGAGEMENT: Review onboarding flow and core feature adoption');
  }

  if (pillars.retention.score === 'healthy') {
    whatsWorking.push({
      metric: 'Retention',
      message: `DAU/MAU: ${(m.dauPerMau.current * 100).toFixed(1)}%`,
      pillar: true
    });
  } else {
    redFlags.push({
      metric: 'Retention',
      message: `DAU/MAU critical: ${(m.dauPerMau.current * 100).toFixed(1)}%`,
      severity: 'critical',
      pillar: true
    });
    recommendations.push('RETENTION: Implement re-engagement campaigns and improve daily value proposition');
  }

  // Overall status
  if (pillars.overall === 'winning') {
    whatsWorking.push({
      metric: 'Overall Health',
      message: 'All 3 pillars healthy - growth trajectory positive',
      pillar: false
    });
  } else if (pillars.overall === 'losing') {
    redFlags.push({
      metric: 'Overall Health',
      message: 'Multiple pillars failing - requires immediate attention',
      severity: 'critical'
    });
  }

  // Shift analysis
  if (shifts.users.length > 0) {
    const recentShift = shifts.users[shifts.users.length - 1];
    if (recentShift.direction === 'decrease') {
      redFlags.push({
        metric: 'Traffic Shift Detected',
        message: `${Math.abs(recentShift.change).toFixed(0)}% drop around ${recentShift.date}`,
        severity: 'medium'
      });
    }
  }

  return { whatsWorking, redFlags, recommendations, pillars };
}

/**
 * Generate AIGNE HTML report
 */
export function generateAIGNEHTML(data, analysis) {
  const m = data.metrics;
  const reportDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // 90-day trend chart data
  const trendLabels = data.trendData.map(d => d.date.slice(4, 6) + '/' + d.date.slice(6));
  const trendUsers = data.trendData.map(d => d.activeUsers);
  const trendSessions = data.trendData.map(d => d.sessions);

  // Weekly aggregation for cleaner 90-day view
  const weeklyData = [];
  for (let i = 0; i < data.trendData.length; i += 7) {
    const week = data.trendData.slice(i, i + 7);
    if (week.length > 0) {
      weeklyData.push({
        label: week[0].date.slice(4, 6) + '/' + week[0].date.slice(6),
        users: week.reduce((sum, d) => sum + d.activeUsers, 0),
        sessions: week.reduce((sum, d) => sum + d.sessions, 0),
        views: week.reduce((sum, d) => sum + d.screenPageViews, 0)
      });
    }
  }

  const formatNum = (n) => n >= 1000 ? (n/1000).toFixed(1) + 'K' : Math.round(n);
  const trendIcon = (change) => change >= 0 ? '<span class="trend-up">↑</span>' : '<span class="trend-down">↓</span>';
  const changeClass = (change) => change >= 0 ? 'positive' : 'negative';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AIGNE Weekly Analytics Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --primary: #059669;
      --secondary: #4F46E5;
      --success: #10B981;
      --warning: #F59E0B;
      --danger: #EF4444;
      --gray-50: #F9FAFB;
      --gray-100: #F3F4F6;
      --gray-200: #E5E7EB;
      --gray-600: #4B5563;
      --gray-800: #1F2937;
      --gray-900: #111827;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--gray-50); color: var(--gray-800); line-height: 1.6; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    header { background: linear-gradient(135deg, var(--primary), #047857); color: white; padding: 2rem; border-radius: 1rem; margin-bottom: 2rem; }
    header h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    .subtitle { opacity: 0.9; }
    .badge { background: rgba(255,255,255,0.2); padding: 0.5rem 1rem; border-radius: 0.5rem; display: inline-block; margin-top: 1rem; font-size: 0.9rem; }
    .grid { display: grid; gap: 1.5rem; }
    .grid-2 { grid-template-columns: repeat(2, 1fr); }
    .grid-3 { grid-template-columns: repeat(3, 1fr); }
    .grid-4 { grid-template-columns: repeat(4, 1fr); }
    @media (max-width: 768px) { .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; } }
    .card { background: white; border-radius: 1rem; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .card-title { font-size: 0.875rem; color: var(--gray-600); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .metric-value { font-size: 2.5rem; font-weight: 700; color: var(--gray-900); }
    .metric-change { font-size: 0.875rem; margin-top: 0.5rem; }
    .metric-change.positive { color: var(--success); }
    .metric-change.negative { color: var(--danger); }
    .trend-up { color: var(--success); }
    .trend-down { color: var(--danger); }
    .section { margin-top: 2rem; }
    .section-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; color: var(--gray-900); }
    .highlight-box { background: linear-gradient(135deg, #ECFDF5, #D1FAE5); border: 2px solid var(--success); border-radius: 1rem; padding: 1.5rem; margin-bottom: 1.5rem; }
    .highlight-box h3 { color: var(--primary); margin-bottom: 0.5rem; }
    .chart-container { position: relative; height: 300px; }
    .insight-card { padding: 1rem; border-radius: 0.75rem; margin-bottom: 1rem; }
    .insight-card.success { background: #ECFDF5; border-left: 4px solid var(--success); }
    .insight-card.warning { background: #FFFBEB; border-left: 4px solid var(--warning); }
    .insight-card.danger { background: #FEF2F2; border-left: 4px solid var(--danger); }
    .insight-title { font-weight: 600; margin-bottom: 0.25rem; }
    .breakdown-table { width: 100%; border-collapse: collapse; }
    .breakdown-table th, .breakdown-table td { padding: 0.75rem; text-align: left; border-bottom: 1px solid var(--gray-200); }
    .breakdown-table th { font-weight: 600; color: var(--gray-600); font-size: 0.875rem; }
    footer { text-align: center; padding: 2rem; color: var(--gray-600); font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>AIGNE Analytics</h1>
      <div class="subtitle">Weekly Performance + SEO Growth Report</div>
      <div class="badge">${reportDate} • ${data.dates.current.start} to ${data.dates.current.end}</div>
    </header>

    <!-- Executive Summary - The Honest Assessment -->
    <div style="background: linear-gradient(135deg, ${m.organicUsers.change >= 0 ? '#d1fae5, #a7f3d0' : '#fef3c7, #fde68a'}); border-radius: 1rem; padding: 1.5rem; margin-bottom: 1.5rem; border-left: 4px solid ${m.organicUsers.change >= 0 ? '#10B981' : '#F59E0B'};">
      <h2 style="margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
        ${m.organicUsers.change >= 0 ? '✅' : '⚠️'} Executive Summary
      </h2>
      <div style="font-size: 1.1rem; line-height: 1.8;">
        <p><strong>Organic Traffic:</strong> ${m.organicUsers.change >= 0 ? 'Growing' : 'Declining'} ${Math.abs(m.organicUsers.change).toFixed(1)}% WoW (${formatNum(m.organicUsers.current)} users)</p>
        <p><strong>SEO Share:</strong> ${m.organicPercent.current.toFixed(1)}% of traffic is organic ${m.organicPercent.current > 25 ? '- healthy foundation' : '- room to grow'}</p>
        <p><strong>90-Day Trajectory:</strong> ${
          weeklyData.length >= 2 ?
            (weeklyData[weeklyData.length-1].users > weeklyData[0].users ?
              `Up ${(((weeklyData[weeklyData.length-1].users - weeklyData[0].users) / weeklyData[0].users) * 100).toFixed(0)}% - content strategy is compounding` :
              `Down ${(((weeklyData[0].users - weeklyData[weeklyData.length-1].users) / weeklyData[0].users) * 100).toFixed(0)}% - needs attention`) :
            'Insufficient data'
        }</p>
      </div>
      <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(0,0,0,0.1);">
        <strong>The Bottom Line:</strong> ${
          m.organicUsers.change >= 10 ? 'SEO strategy is working. Continue adding content to compound growth.' :
          m.organicUsers.change >= 0 ? 'Organic is stable but not growing fast. Consider increasing content velocity or improving keyword targeting.' :
          'Organic traffic declining. Review recent content quality, check for technical SEO issues, or revisit keyword strategy.'
        }
      </div>
    </div>

    <!-- Organic Search Highlight -->
    <div class="highlight-box">
      <h3>🔍 Organic Search Performance</h3>
      <div class="grid grid-3" style="margin-top: 1rem;">
        <div>
          <div style="font-size: 0.875rem; color: var(--gray-600);">Organic Users</div>
          <div style="font-size: 1.5rem; font-weight: 700;">${formatNum(m.organicUsers.current)}</div>
          <div class="metric-change ${changeClass(m.organicUsers.change)}">${trendIcon(m.organicUsers.change)} ${Math.abs(m.organicUsers.change).toFixed(1)}%</div>
        </div>
        <div>
          <div style="font-size: 0.875rem; color: var(--gray-600);">Organic Sessions</div>
          <div style="font-size: 1.5rem; font-weight: 700;">${formatNum(m.organicSessions.current)}</div>
          <div class="metric-change ${changeClass(m.organicSessions.change)}">${trendIcon(m.organicSessions.change)} ${Math.abs(m.organicSessions.change).toFixed(1)}%</div>
        </div>
        <div>
          <div style="font-size: 0.875rem; color: var(--gray-600);">Organic % of Total</div>
          <div style="font-size: 1.5rem; font-weight: 700;">${m.organicPercent.current.toFixed(1)}%</div>
          <div class="metric-change ${changeClass(m.organicPercent.change)}">${m.organicPercent.change >= 0 ? '+' : ''}${m.organicPercent.change.toFixed(1)}pp</div>
        </div>
      </div>
    </div>

    <!-- Key Metrics -->
    <div class="grid grid-4">
      <div class="card">
        <div class="card-title">Active Users</div>
        <div class="metric-value">${formatNum(m.activeUsers.current)}</div>
        <div class="metric-change ${changeClass(m.activeUsers.change)}">${trendIcon(m.activeUsers.change)} ${Math.abs(m.activeUsers.change).toFixed(1)}%</div>
      </div>
      <div class="card">
        <div class="card-title">Page Views</div>
        <div class="metric-value">${formatNum(m.screenPageViews.current)}</div>
        <div class="metric-change ${changeClass(m.screenPageViews.change)}">${trendIcon(m.screenPageViews.change)} ${Math.abs(m.screenPageViews.change).toFixed(1)}%</div>
      </div>
      <div class="card">
        <div class="card-title">Sessions</div>
        <div class="metric-value">${formatNum(m.sessions.current)}</div>
        <div class="metric-change ${changeClass(m.sessions.change)}">${trendIcon(m.sessions.change)} ${Math.abs(m.sessions.change).toFixed(1)}%</div>
      </div>
      <div class="card">
        <div class="card-title">Engagement Rate</div>
        <div class="metric-value">${(m.engagementRate.current * 100).toFixed(1)}%</div>
        <div class="metric-change ${changeClass(m.engagementRate.change)}">${trendIcon(m.engagementRate.change)} ${Math.abs(m.engagementRate.change).toFixed(1)}%</div>
      </div>
    </div>

    <!-- 90-Day Growth Trajectory -->
    <div class="section">
      <div class="section-title">📈 90-Day Growth Trajectory</div>
      <div class="card">
        <div class="chart-container">
          <canvas id="trendChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Traffic Sources -->
    <div class="section">
      <div class="section-title">Traffic Sources</div>
      <div class="card">
        <table class="breakdown-table">
          <thead><tr><th>Channel</th><th>Users</th><th>Sessions</th><th>Engagement</th></tr></thead>
          <tbody>
            ${data.sourceBreakdown.sort((a,b) => b.activeUsers - a.activeUsers).slice(0, 8).map(row => `
              <tr>
                <td><strong>${row.sessionDefaultChannelGroup}</strong></td>
                <td>${formatNum(row.activeUsers)}</td>
                <td>${formatNum(row.sessions)}</td>
                <td>${(row.engagementRate * 100).toFixed(1)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Top Landing Pages -->
    <div class="section">
      <div class="section-title">Top Landing Pages (SEO Performance)</div>
      <div class="card">
        <table class="breakdown-table">
          <thead><tr><th>Page</th><th>Sessions</th><th>Engagement</th><th>Bounce</th></tr></thead>
          <tbody>
            ${data.landingPages.slice(0, 10).map(row => `
              <tr>
                <td style="max-width: 400px; overflow: hidden; text-overflow: ellipsis;">${row.landingPage}</td>
                <td>${formatNum(row.sessions)}</td>
                <td>${(row.engagementRate * 100).toFixed(1)}%</td>
                <td>${(row.bounceRate * 100).toFixed(1)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Insights -->
    <div class="section">
      <div class="grid grid-2">
        <div>
          <div class="section-title">✅ What's Working</div>
          ${analysis.whatsWorking.length > 0
            ? analysis.whatsWorking.map(item => `
              <div class="insight-card success">
                <div class="insight-title">${item.metric}</div>
                <div>${item.message}</div>
                ${item.insight ? `<div style="font-size: 0.875rem; color: var(--gray-600); margin-top: 0.5rem;">${item.insight}</div>` : ''}
              </div>
            `).join('')
            : '<div class="insight-card success">Analysis in progress...</div>'
          }
        </div>
        <div>
          <div class="section-title">🚨 Red Flags</div>
          ${analysis.redFlags.length > 0
            ? analysis.redFlags.map(item => `
              <div class="insight-card ${item.severity === 'high' ? 'danger' : 'warning'}">
                <div class="insight-title">${item.metric}</div>
                <div>${item.message}</div>
              </div>
            `).join('')
            : '<div class="insight-card success">No red flags detected</div>'
          }
        </div>
      </div>
    </div>

    <!-- Team Learnings Section -->
    <div class="section">
      <div class="card" style="border: 2px dashed var(--gray-200); background: var(--gray-50);">
        <h3 style="color: var(--gray-600); margin-bottom: 1rem;">📝 Team Learnings & Notes</h3>
        <div style="color: var(--gray-600); font-size: 0.9rem;">
          <p><em>Space for weekly learnings from SEO/content strategy.</em></p>
          <div style="margin-top: 1rem; padding: 1rem; background: white; border-radius: 0.5rem; min-height: 100px;">
            <p style="color: var(--gray-400);">Add your learnings here after the Thursday review...</p>
            <ul style="margin-top: 0.5rem; margin-left: 1.5rem; color: var(--gray-500);">
              <li>Which content types are driving the most traffic?</li>
              <li>What keywords are we ranking for?</li>
              <li>What should we create more of next week?</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <footer>Generated by Content Automation Hub • ${data.generatedAt}</footer>
  </div>

  <script>
    const ctx = document.getElementById('trendChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(weeklyData.map(w => w.label))},
        datasets: [{
          label: 'Weekly Users',
          data: ${JSON.stringify(weeklyData.map(w => w.users))},
          borderColor: '#059669',
          backgroundColor: 'rgba(5, 150, 105, 0.1)',
          fill: true,
          tension: 0.3
        }, {
          label: 'Weekly Sessions',
          data: ${JSON.stringify(weeklyData.map(w => w.sessions))},
          borderColor: '#4F46E5',
          backgroundColor: 'rgba(79, 70, 229, 0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true } }
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Generate ArcSphere HTML report with 3-pillar focus
 */
export function generateArcSphereHTML(data, analysis) {
  const m = data.metrics;
  const { pillars } = data;
  const reportDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Baseline trend chart (since Dec 23)
  const baselineLabels = data.baselineTrend.map(d => d.date.slice(4, 6) + '/' + d.date.slice(6));
  const baselineUsers = data.baselineTrend.map(d => d.activeUsers);
  const baselineSessions = data.baselineTrend.map(d => d.sessions);

  const formatNum = (n) => n >= 1000 ? (n/1000).toFixed(1) + 'K' : Math.round(n);
  const trendIcon = (change) => change >= 0 ? '<span class="trend-up">↑</span>' : '<span class="trend-down">↓</span>';
  const changeClass = (change) => change >= 0 ? 'positive' : 'negative';

  const pillarColor = (score) => {
    if (score === 'healthy') return '#10B981';
    if (score === 'needs_attention') return '#F59E0B';
    return '#EF4444';
  };

  const pillarIcon = (score) => {
    if (score === 'healthy') return '✅';
    if (score === 'needs_attention') return '⚠️';
    return '🚨';
  };

  const overallStatusColor = pillars.overall === 'winning' ? '#10B981' : pillars.overall === 'at_risk' ? '#F59E0B' : '#EF4444';
  const overallStatusText = pillars.overall === 'winning' ? 'ALL PILLARS HEALTHY' : pillars.overall === 'at_risk' ? 'AT RISK' : 'NEEDS ATTENTION';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ArcSphere Weekly Analytics Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation"></script>
  <style>
    :root {
      --primary: #4F46E5;
      --success: #10B981;
      --warning: #F59E0B;
      --danger: #EF4444;
      --gray-50: #F9FAFB;
      --gray-100: #F3F4F6;
      --gray-200: #E5E7EB;
      --gray-600: #4B5563;
      --gray-800: #1F2937;
      --gray-900: #111827;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--gray-50); color: var(--gray-800); line-height: 1.6; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    header { background: linear-gradient(135deg, var(--primary), #7C3AED); color: white; padding: 2rem; border-radius: 1rem; margin-bottom: 2rem; }
    header h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    .subtitle { opacity: 0.9; }
    .badge { background: rgba(255,255,255,0.2); padding: 0.5rem 1rem; border-radius: 0.5rem; display: inline-block; margin-top: 1rem; font-size: 0.9rem; }
    .status-banner { padding: 1rem 1.5rem; border-radius: 1rem; margin-bottom: 2rem; color: white; font-weight: 600; font-size: 1.25rem; text-align: center; }
    .pillars { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; margin-bottom: 2rem; }
    .pillar-card { background: white; border-radius: 1rem; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-top: 4px solid; }
    .pillar-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
    .pillar-title { font-size: 1.25rem; font-weight: 600; }
    .pillar-metric { font-size: 2rem; font-weight: 700; }
    .pillar-desc { font-size: 0.875rem; color: var(--gray-600); margin-top: 0.5rem; }
    .grid { display: grid; gap: 1.5rem; }
    .grid-2 { grid-template-columns: repeat(2, 1fr); }
    .grid-4 { grid-template-columns: repeat(4, 1fr); }
    @media (max-width: 768px) { .pillars, .grid-2, .grid-4 { grid-template-columns: 1fr; } }
    .card { background: white; border-radius: 1rem; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .card-title { font-size: 0.875rem; color: var(--gray-600); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .metric-value { font-size: 2rem; font-weight: 700; color: var(--gray-900); }
    .metric-change { font-size: 0.875rem; margin-top: 0.5rem; }
    .metric-change.positive { color: var(--success); }
    .metric-change.negative { color: var(--danger); }
    .trend-up { color: var(--success); }
    .trend-down { color: var(--danger); }
    .section { margin-top: 2rem; }
    .section-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; color: var(--gray-900); }
    .chart-container { position: relative; height: 350px; }
    .annotation { background: var(--gray-100); padding: 0.5rem 1rem; border-radius: 0.5rem; margin-bottom: 0.5rem; display: flex; gap: 1rem; align-items: center; }
    .annotation.positive { border-left: 3px solid var(--success); }
    .annotation.negative { border-left: 3px solid var(--danger); }
    .insight-card { padding: 1rem; border-radius: 0.75rem; margin-bottom: 1rem; }
    .insight-card.success { background: #ECFDF5; border-left: 4px solid var(--success); }
    .insight-card.warning { background: #FFFBEB; border-left: 4px solid var(--warning); }
    .insight-card.danger { background: #FEF2F2; border-left: 4px solid var(--danger); }
    .insight-title { font-weight: 600; margin-bottom: 0.25rem; }
    .breakdown-table { width: 100%; border-collapse: collapse; }
    .breakdown-table th, .breakdown-table td { padding: 0.75rem; text-align: left; border-bottom: 1px solid var(--gray-200); }
    footer { text-align: center; padding: 2rem; color: var(--gray-600); font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>ArcSphere Analytics</h1>
      <div class="subtitle">Weekly Performance Report • Since Google Ads Launch</div>
      <div class="badge">${reportDate} • Baseline: Dec 23, 2025</div>
    </header>

    <!-- Overall Status -->
    <div class="status-banner" style="background: ${overallStatusColor};">
      ${overallStatusText}
    </div>

    <!-- 3 Pillars -->
    <div class="pillars">
      <div class="pillar-card" style="border-color: ${pillarColor(pillars.conversion.score)}">
        <div class="pillar-header">
          <span style="font-size: 1.5rem;">${pillarIcon(pillars.conversion.score)}</span>
          <span class="pillar-title">CONVERSION</span>
        </div>
        <div class="pillar-metric">${formatNum(m.newUsers.current)}</div>
        <div class="metric-change ${changeClass(m.newUsers.change)}">${trendIcon(m.newUsers.change)} ${Math.abs(m.newUsers.change).toFixed(1)}% new users</div>
        <div class="pillar-desc">${pillars.conversion.description}</div>
      </div>
      <div class="pillar-card" style="border-color: ${pillarColor(pillars.engagement.score)}">
        <div class="pillar-header">
          <span style="font-size: 1.5rem;">${pillarIcon(pillars.engagement.score)}</span>
          <span class="pillar-title">ENGAGEMENT</span>
        </div>
        <div class="pillar-metric">${(m.engagementRate.current * 100).toFixed(1)}%</div>
        <div class="metric-change ${changeClass(m.engagementRate.change)}">${trendIcon(m.engagementRate.change)} ${Math.abs(m.engagementRate.change).toFixed(1)}% change</div>
        <div class="pillar-desc">${pillars.engagement.description}</div>
      </div>
      <div class="pillar-card" style="border-color: ${pillarColor(pillars.retention.score)}">
        <div class="pillar-header">
          <span style="font-size: 1.5rem;">${pillarIcon(pillars.retention.score)}</span>
          <span class="pillar-title">RETENTION</span>
        </div>
        <div class="pillar-metric">${(m.dauPerMau.current * 100).toFixed(1)}%</div>
        <div class="metric-change ${changeClass(m.dauPerMau.change)}">${trendIcon(m.dauPerMau.change)} DAU/MAU</div>
        <div class="pillar-desc">${pillars.retention.description}</div>
      </div>
    </div>

    <!-- Key Metrics Grid -->
    <div class="grid grid-4">
      <div class="card">
        <div class="card-title">Active Users</div>
        <div class="metric-value">${formatNum(m.activeUsers.current)}</div>
        <div class="metric-change ${changeClass(m.activeUsers.change)}">${trendIcon(m.activeUsers.change)} ${Math.abs(m.activeUsers.change).toFixed(1)}%</div>
      </div>
      <div class="card">
        <div class="card-title">Sessions</div>
        <div class="metric-value">${formatNum(m.sessions.current)}</div>
        <div class="metric-change ${changeClass(m.sessions.change)}">${trendIcon(m.sessions.change)} ${Math.abs(m.sessions.change).toFixed(1)}%</div>
      </div>
      <div class="card">
        <div class="card-title">Page Views</div>
        <div class="metric-value">${formatNum(m.screenPageViews.current)}</div>
        <div class="metric-change ${changeClass(m.screenPageViews.change)}">${trendIcon(m.screenPageViews.change)} ${Math.abs(m.screenPageViews.change).toFixed(1)}%</div>
      </div>
      <div class="card">
        <div class="card-title">DAU/WAU</div>
        <div class="metric-value">${(m.dauPerWau.current * 100).toFixed(1)}%</div>
        <div class="metric-change ${changeClass(m.dauPerWau.change)}">${trendIcon(m.dauPerWau.change)} ${Math.abs(m.dauPerWau.change).toFixed(1)}%</div>
      </div>
    </div>

    <!-- Trend Since Google Ads Launch -->
    <div class="section">
      <div class="section-title">📈 Performance Since Google Ads Launch (Dec 23)</div>
      <div class="card">
        <div style="margin-bottom: 1rem;">
          ${data.annotations.map(a => `
            <div class="annotation ${a.type}">
              <strong>${a.date.slice(4,6)}/${a.date.slice(6,8)}/${a.date.slice(0,4)}</strong>
              <span>${a.event}</span>
            </div>
          `).join('')}
        </div>
        <div class="chart-container">
          <canvas id="baselineChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Shift Detection -->
    ${data.shifts.users.length > 0 ? `
    <div class="section">
      <div class="section-title">🔄 Detected Traffic Shifts</div>
      <div class="card">
        ${data.shifts.users.slice(-5).map(shift => `
          <div class="annotation ${shift.direction === 'increase' ? 'positive' : 'negative'}">
            <strong>${shift.date.slice(4,6)}/${shift.date.slice(6,8)}</strong>
            <span>${shift.direction === 'increase' ? '↑' : '↓'} ${Math.abs(shift.change).toFixed(0)}% shift (${formatNum(shift.from)} → ${formatNum(shift.to)} users)</span>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <!-- Insights -->
    <div class="section">
      <div class="grid grid-2">
        <div>
          <div class="section-title">✅ What's Working</div>
          ${analysis.whatsWorking.map(item => `
            <div class="insight-card success">
              <div class="insight-title">${item.pillar ? '🎯 ' : ''}${item.metric}</div>
              <div>${item.message}</div>
            </div>
          `).join('')}
        </div>
        <div>
          <div class="section-title">🚨 Red Flags</div>
          ${analysis.redFlags.length > 0
            ? analysis.redFlags.map(item => `
              <div class="insight-card ${item.severity === 'critical' ? 'danger' : item.severity === 'high' ? 'danger' : 'warning'}">
                <div class="insight-title">${item.pillar ? '🎯 ' : ''}${item.metric}</div>
                <div>${item.message}</div>
              </div>
            `).join('')
            : '<div class="insight-card success">No red flags detected</div>'
          }
        </div>
      </div>
    </div>

    <!-- Recommendations -->
    ${analysis.recommendations.length > 0 ? `
    <div class="section">
      <div class="section-title">💡 Recommendations</div>
      <div class="card">
        ${analysis.recommendations.map(rec => `
          <div style="padding: 0.75rem; background: var(--gray-100); border-radius: 0.5rem; margin-bottom: 0.5rem;">
            → ${rec}
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <!-- Platform Breakdown -->
    <div class="section">
      <div class="section-title">Platform Breakdown</div>
      <div class="card">
        <table class="breakdown-table">
          <thead><tr><th>Platform</th><th>Users</th><th>Sessions</th><th>Engagement</th></tr></thead>
          <tbody>
            ${data.platformBreakdown.map(row => `
              <tr>
                <td><strong>${row.platform}</strong></td>
                <td>${formatNum(row.activeUsers)}</td>
                <td>${formatNum(row.sessions)}</td>
                <td>${(row.engagementRate * 100).toFixed(1)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <footer>Generated by Content Automation Hub • ${data.generatedAt}</footer>
  </div>

  <script>
    const ctx = document.getElementById('baselineChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(baselineLabels)},
        datasets: [{
          label: 'Daily Active Users',
          data: ${JSON.stringify(baselineUsers)},
          borderColor: '#4F46E5',
          backgroundColor: 'rgba(79, 70, 229, 0.1)',
          fill: true,
          tension: 0.2
        }, {
          label: 'Sessions',
          data: ${JSON.stringify(baselineSessions)},
          borderColor: '#10B981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          annotation: {
            annotations: {
              line1: {
                type: 'line',
                xMin: '12/23',
                xMax: '12/23',
                borderColor: '#10B981',
                borderWidth: 2,
                label: { content: 'Ads Launch', enabled: true }
              }
            }
          }
        },
        scales: { y: { beginAtZero: true } }
      }
    });
  </script>
</body>
</html>`;
}

// Legacy exports for compatibility
export async function fetchAnalytics(propertyId, config = {}) {
  // Determine which fetch function to use based on config
  if (config.propertyName === 'AIGNE') {
    return fetchAIGNEAnalytics(propertyId, config);
  }
  return fetchArcSphereAnalytics(propertyId, config);
}

export function analyzeData(data, thresholds = {}) {
  if (data.propertyName === 'AIGNE') {
    return analyzeAIGNE(data, thresholds);
  }
  return analyzeArcSphere(data, thresholds);
}

export function generateHTML(data, analysis, propertyName) {
  if (propertyName === 'AIGNE' || data.propertyName === 'AIGNE') {
    return generateAIGNEHTML(data, analysis);
  }
  return generateArcSphereHTML(data, analysis);
}

export default {
  fetchAnalytics,
  fetchAIGNEAnalytics,
  fetchArcSphereAnalytics,
  analyzeData,
  analyzeAIGNE,
  analyzeArcSphere,
  generateHTML,
  generateAIGNEHTML,
  generateArcSphereHTML
};
