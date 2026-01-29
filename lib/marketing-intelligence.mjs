/**
 * Marketing Intelligence Report Generator v2.0
 * AI-Powered Growth Analytics for Hyper-Growth Decision Making
 *
 * Combines Google Ads + GA4 data with:
 * - Week-over-week comparisons
 * - Cohort retention analysis
 * - 30-day trajectory trends
 * - Strategic recommendations engine
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const PIPX_PYTHON = path.join(process.env.HOME, '.local/pipx/venvs/analytics-mcp/bin/python');

/**
 * Fetch GA4 metrics for a date range
 */
async function fetchGA4Metrics(propertyId, startDate, endDate) {
  const script = `
import json
import sys
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import RunReportRequest, DateRange, Metric, Dimension

client = BetaAnalyticsDataClient()
property_id = sys.argv[1]
start_date = sys.argv[2]
end_date = sys.argv[3]

result = {}

# Core metrics (aggregated correctly)
request = RunReportRequest(
    property=f"properties/{property_id}",
    date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
    metrics=[
        Metric(name="activeUsers"),
        Metric(name="newUsers"),
        Metric(name="sessions"),
        Metric(name="engagedSessions"),
        Metric(name="engagementRate"),
        Metric(name="averageSessionDuration"),
        Metric(name="screenPageViewsPerSession"),
        Metric(name="bounceRate"),
        Metric(name="screenPageViews"),
        Metric(name="eventCount"),
    ],
)
response = client.run_report(request)

if response.rows:
    for i, header in enumerate(response.metric_headers):
        val = float(response.rows[0].metric_values[i].value)
        result[header.name] = val

# Retention metrics (point-in-time, last day of period)
request2 = RunReportRequest(
    property=f"properties/{property_id}",
    date_ranges=[DateRange(start_date=end_date, end_date=end_date)],
    metrics=[
        Metric(name="dauPerMau"),
        Metric(name="dauPerWau"),
        Metric(name="wauPerMau"),
    ],
)
response2 = client.run_report(request2)

if response2.rows:
    for i, header in enumerate(response2.metric_headers):
        val = float(response2.rows[0].metric_values[i].value)
        result[header.name] = val

# Daily trend
request3 = RunReportRequest(
    property=f"properties/{property_id}",
    date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
    dimensions=[Dimension(name="date")],
    metrics=[
        Metric(name="activeUsers"),
        Metric(name="newUsers"),
        Metric(name="sessions"),
    ],
)
response3 = client.run_report(request3)

daily = []
for row in response3.rows:
    daily.append({
        "date": row.dimension_values[0].value,
        "activeUsers": int(float(row.metric_values[0].value)),
        "newUsers": int(float(row.metric_values[1].value)),
        "sessions": int(float(row.metric_values[2].value)),
    })
result["daily"] = sorted(daily, key=lambda x: x["date"])

# Traffic sources
request4 = RunReportRequest(
    property=f"properties/{property_id}",
    date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
    dimensions=[Dimension(name="sessionDefaultChannelGroup")],
    metrics=[
        Metric(name="activeUsers"),
        Metric(name="sessions"),
        Metric(name="engagementRate"),
    ],
)
response4 = client.run_report(request4)

sources = []
for row in response4.rows:
    sources.append({
        "channel": row.dimension_values[0].value,
        "users": int(float(row.metric_values[0].value)),
        "sessions": int(float(row.metric_values[1].value)),
        "engagementRate": float(row.metric_values[2].value),
    })
result["sources"] = sorted(sources, key=lambda x: x["users"], reverse=True)

print(json.dumps(result))
`;

  return new Promise((resolve, reject) => {
    const proc = spawn(PIPX_PYTHON, ['-c', script, propertyId, startDate, endDate]);
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code !== 0) reject(new Error(stderr));
      else resolve(JSON.parse(stdout));
    });
  });
}

/**
 * Fetch weekly cohort retention data from GA4
 * Shows how users acquired in each week are retaining
 */
async function fetchCohortRetention(propertyId, weeksBack = 6) {
  const script = `
import json
import sys
from datetime import datetime, timedelta
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    RunReportRequest, DateRange, Metric, Dimension, CohortSpec,
    Cohort, CohortsRange
)

client = BetaAnalyticsDataClient()
property_id = sys.argv[1]
weeks_back = int(sys.argv[2])

# Calculate cohort date ranges (weekly cohorts)
today = datetime.now()
cohorts_data = []

# Get weekly user counts and retention
for week in range(weeks_back):
    week_start = today - timedelta(days=(week + 1) * 7)
    week_end = today - timedelta(days=week * 7 + 1)

    # Get new users for this week
    request = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[DateRange(
            start_date=week_start.strftime('%Y-%m-%d'),
            end_date=week_end.strftime('%Y-%m-%d')
        )],
        metrics=[
            Metric(name="newUsers"),
            Metric(name="activeUsers"),
        ],
    )

    response = client.run_report(request)

    new_users = 0
    active_users = 0
    if response.rows:
        new_users = int(float(response.rows[0].metric_values[0].value))
        active_users = int(float(response.rows[0].metric_values[1].value))

    cohorts_data.append({
        "week": f"W-{week}",
        "weekStart": week_start.strftime('%Y-%m-%d'),
        "weekEnd": week_end.strftime('%Y-%m-%d'),
        "newUsers": new_users,
        "activeUsers": active_users,
        "retentionRate": active_users / new_users if new_users > 0 else 0,
    })

print(json.dumps({"cohorts": cohorts_data}))
`;

  return new Promise((resolve, reject) => {
    const proc = spawn(PIPX_PYTHON, ['-c', script, propertyId, String(weeksBack)]);
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code !== 0) {
        console.log('   Cohort fetch warning:', stderr.slice(0, 100));
        resolve({ cohorts: [] });
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          resolve({ cohorts: [] });
        }
      }
    });
  });
}

/**
 * Fetch 30-day trajectory data for trend analysis
 */
async function fetchTrajectory(propertyId, days = 30) {
  const script = `
import json
import sys
from datetime import datetime, timedelta
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import RunReportRequest, DateRange, Metric, Dimension

client = BetaAnalyticsDataClient()
property_id = sys.argv[1]
days = int(sys.argv[2])

today = datetime.now()
start_date = (today - timedelta(days=days)).strftime('%Y-%m-%d')
end_date = (today - timedelta(days=1)).strftime('%Y-%m-%d')

# Weekly aggregates for cleaner trend
request = RunReportRequest(
    property=f"properties/{property_id}",
    date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
    dimensions=[Dimension(name="week")],
    metrics=[
        Metric(name="activeUsers"),
        Metric(name="newUsers"),
        Metric(name="sessions"),
        Metric(name="engagementRate"),
    ],
)

response = client.run_report(request)

weeks = []
for row in response.rows:
    weeks.append({
        "week": row.dimension_values[0].value,
        "activeUsers": int(float(row.metric_values[0].value)),
        "newUsers": int(float(row.metric_values[1].value)),
        "sessions": int(float(row.metric_values[2].value)),
        "engagementRate": float(row.metric_values[3].value),
    })

weeks = sorted(weeks, key=lambda x: x["week"])

# Calculate trajectory (linear regression slope)
if len(weeks) >= 2:
    users = [w["activeUsers"] for w in weeks]
    n = len(users)
    x_mean = (n - 1) / 2
    y_mean = sum(users) / n

    numerator = sum((i - x_mean) * (users[i] - y_mean) for i in range(n))
    denominator = sum((i - x_mean) ** 2 for i in range(n))

    slope = numerator / denominator if denominator != 0 else 0

    # Growth rate as percentage
    first_week_avg = sum(users[:2]) / 2 if len(users) >= 2 else users[0]
    last_week_avg = sum(users[-2:]) / 2 if len(users) >= 2 else users[-1]
    growth_rate = (last_week_avg - first_week_avg) / first_week_avg if first_week_avg > 0 else 0
else:
    slope = 0
    growth_rate = 0

print(json.dumps({
    "weeks": weeks,
    "slope": slope,
    "growthRate": growth_rate,
    "trend": "growing" if growth_rate > 0.05 else "declining" if growth_rate < -0.05 else "stable"
}))
`;

  return new Promise((resolve, reject) => {
    const proc = spawn(PIPX_PYTHON, ['-c', script, propertyId, String(days)]);
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code !== 0) {
        console.log('   Trajectory fetch warning:', stderr.slice(0, 100));
        resolve({ weeks: [], slope: 0, growthRate: 0, trend: 'unknown' });
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          resolve({ weeks: [], slope: 0, growthRate: 0, trend: 'unknown' });
        }
      }
    });
  });
}

/**
 * Parse Google Ads data from existing report files
 */
async function fetchGoogleAdsFromReports(reportsDir) {
  const result = {
    campaigns: [],
    totals: { spend: 0, conversions: 0, clicks: 0, impressions: 0, cpa: 0, ctr: 0 },
    error: null,
    source: null,
  };

  try {
    let files = [];
    files = await fs.readdir(reportsDir);

    const auditFiles = files.filter(f => f.startsWith('audit-') && f.endsWith('.md')).sort().reverse();

    if (auditFiles.length > 0) {
      const auditPath = path.join(reportsDir, auditFiles[0]);
      const content = await fs.readFile(auditPath, 'utf8');

      const lines = content.split('\n');

      for (const line of lines) {
        if (line.includes('|') && line.includes('conv') && line.includes('$') && !line.includes('TOTAL')) {
          const parts = line.split('|').map(p => p.trim());
          if (parts.length >= 5) {
            const name = parts[0];
            const status = parts[1];

            const spendMatch = parts[2].match(/\$\s*([\d.]+)/);
            const spend = spendMatch ? parseFloat(spendMatch[1]) : 0;

            const convMatch = parts[3].match(/([\d.]+)\s*conv/);
            const conversions = convMatch ? parseFloat(convMatch[1]) : 0;

            const cpaMatch = parts[4].match(/\$\s*([\d.]+)/);
            const cpa = cpaMatch ? parseFloat(cpaMatch[1]) : 0;

            if (status !== 'REMOVED' && name && !name.includes('---')) {
              result.campaigns.push({
                name, status, spend, conversions, cpa,
                clicks: 0, impressions: 0, ctr: 0,
              });
            }
          }
        }

        if (line.includes('TOTAL') && line.includes('|')) {
          const parts = line.split('|').map(p => p.trim());
          if (parts.length >= 5) {
            const spendMatch = parts[2].match(/\$\s*([\d.]+)/);
            const convMatch = parts[3].match(/([\d.]+)\s*conv/);
            const cpaMatch = parts[4].match(/\$\s*([\d.]+)/);

            result.totals.spend = spendMatch ? parseFloat(spendMatch[1]) : 0;
            result.totals.conversions = convMatch ? parseFloat(convMatch[1]) : 0;
            result.totals.cpa = cpaMatch ? parseFloat(cpaMatch[1]) : 0;
          }
        }
      }

      result.source = auditPath;
    }

    const jsonFiles = files.filter(f => f.startsWith('daily-') && f.endsWith('.json')).sort().reverse();

    if (jsonFiles.length > 0 && result.campaigns.length === 0) {
      const jsonPath = path.join(reportsDir, jsonFiles[0]);
      const jsonContent = JSON.parse(await fs.readFile(jsonPath, 'utf8'));

      if (jsonContent.summary) {
        result.totals.spend = parseFloat(jsonContent.summary.spend) || 0;
        result.totals.conversions = parseFloat(jsonContent.summary.conversions) || 0;
        result.totals.clicks = parseFloat(jsonContent.summary.clicks) || 0;
        result.totals.impressions = parseFloat(jsonContent.summary.impressions) || 0;
        result.totals.ctr = parseFloat(jsonContent.summary.ctr) || 0;
        result.totals.cpa = result.totals.conversions > 0
          ? result.totals.spend / result.totals.conversions
          : 0;
        result.source = jsonPath;
      }
    }

    if (result.campaigns.length === 0 && result.totals.spend === 0) {
      result.error = 'No Google Ads report files found';
    }

  } catch (e) {
    result.error = e.message;
  }

  return result;
}

/**
 * Fetch Google Ads data - tries reports first, then API
 */
async function fetchGoogleAdsData(customerId, mcpServerPath, startDate, endDate, reportsDir = null) {
  if (reportsDir) {
    try {
      const fromReports = await fetchGoogleAdsFromReports(reportsDir);
      if (!fromReports.error && fromReports.totals && fromReports.totals.spend > 0) {
        console.log(`   ✓ Loaded from: ${fromReports.source}`);
        return fromReports;
      }
    } catch (e) {
      // Fall through to API
    }
  }

  const script = `
import json
import sys
sys.path.insert(0, '${mcpServerPath}')

try:
    from google.ads.googleads.client import GoogleAdsClient
    from google.ads.googleads.errors import GoogleAdsException

    client = GoogleAdsClient.load_from_storage('${mcpServerPath}/google-ads.yaml')
    ga_service = client.get_service("GoogleAdsService")

    customer_id = "${customerId}"

    query = """
        SELECT
            campaign.name,
            campaign.status,
            metrics.cost_micros,
            metrics.conversions,
            metrics.clicks,
            metrics.impressions,
            metrics.ctr,
            metrics.average_cpc
        FROM campaign
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status != 'REMOVED'
    """

    response = ga_service.search_stream(customer_id=customer_id, query=query)

    campaigns = []
    totals = {"spend": 0, "conversions": 0, "clicks": 0, "impressions": 0}

    for batch in response:
        for row in batch.results:
            spend = row.metrics.cost_micros / 1_000_000
            campaigns.append({
                "name": row.campaign.name,
                "status": row.campaign.status.name,
                "spend": spend,
                "conversions": row.metrics.conversions,
                "clicks": row.metrics.clicks,
                "impressions": row.metrics.impressions,
                "ctr": row.metrics.ctr * 100,
                "cpc": row.metrics.average_cpc / 1_000_000 if row.metrics.average_cpc else 0,
            })
            totals["spend"] += spend
            totals["conversions"] += row.metrics.conversions
            totals["clicks"] += row.metrics.clicks
            totals["impressions"] += row.metrics.impressions

    totals["cpa"] = totals["spend"] / totals["conversions"] if totals["conversions"] > 0 else 0
    totals["ctr"] = (totals["clicks"] / totals["impressions"] * 100) if totals["impressions"] > 0 else 0

    print(json.dumps({"campaigns": campaigns, "totals": totals, "error": None}))

except Exception as e:
    print(json.dumps({"campaigns": [], "totals": {}, "error": str(e)}))
`;

  return new Promise((resolve, reject) => {
    const pythonPath = path.join(mcpServerPath, '.venv/bin/python3');
    const proc = spawn(pythonPath, ['-c', script]);
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        resolve({ campaigns: [], totals: { spend: 0, conversions: 0, clicks: 0, impressions: 0, cpa: 0 }, error: stderr || e.message });
      }
    });
  });
}

/**
 * Calculate week-over-week changes
 */
function calculateWoW(current, previous) {
  const changes = {};

  const metrics = ['activeUsers', 'newUsers', 'sessions', 'engagedSessions', 'engagementRate', 'dauPerMau'];

  for (const metric of metrics) {
    const curr = current[metric] || 0;
    const prev = previous[metric] || 0;

    if (prev > 0) {
      changes[metric] = {
        current: curr,
        previous: prev,
        change: curr - prev,
        changePercent: ((curr - prev) / prev) * 100,
      };
    } else {
      changes[metric] = {
        current: curr,
        previous: prev,
        change: curr,
        changePercent: curr > 0 ? 100 : 0,
      };
    }
  }

  return changes;
}

/**
 * Generate strategic insights based on all data
 */
function generateStrategicInsights(ga4, ads, trajectory, cohorts, wow, targets) {
  const insights = {
    executiveSummary: [],
    acquisition: { status: 'unknown', score: 0, metrics: {}, issues: [], actions: [], verdict: '' },
    engagement: { status: 'unknown', score: 0, metrics: {}, issues: [], actions: [], verdict: '' },
    retention: { status: 'unknown', score: 0, metrics: {}, issues: [], actions: [], verdict: '' },
    trajectory: { trend: 'unknown', verdict: '', forecast: '' },
    unitEconomics: { metrics: {}, verdict: '' },
    overall: { status: 'unknown', score: 0, summary: '', readyToScale: false, blockingIssue: '' },
    prioritizedActions: [],
  };

  const {
    targetCPA = 0.50,
    targetEngagement = 0.50,
    targetDAUMAU = 0.10,
  } = targets;

  // === ACQUISITION ANALYSIS ===
  if (ads.totals && ads.totals.spend > 0) {
    const cpa = ads.totals.cpa;
    const cpaEfficiency = targetCPA / cpa;

    insights.acquisition.metrics = {
      spend: ads.totals.spend,
      conversions: ads.totals.conversions,
      cpa,
      cpaTarget: targetCPA,
      cpaEfficiency,
      clicks: ads.totals.clicks,
      impressions: ads.totals.impressions,
      ctr: ads.totals.ctr,
    };

    if (cpa <= targetCPA * 0.25) {
      insights.acquisition.status = 'excellent';
      insights.acquisition.score = 100;
      insights.acquisition.verdict = `CPA of $${cpa.toFixed(2)} is ${Math.round(cpaEfficiency)}x better than target. Acquisition is highly efficient.`;
      insights.acquisition.actions.push('SCALE: Increase budget - you have significant headroom before hitting target CPA');
    } else if (cpa <= targetCPA * 0.5) {
      insights.acquisition.status = 'excellent';
      insights.acquisition.score = 90;
      insights.acquisition.verdict = `CPA well below target with room to scale.`;
      insights.acquisition.actions.push('Consider 2x budget increase while monitoring CPA');
    } else if (cpa <= targetCPA) {
      insights.acquisition.status = 'healthy';
      insights.acquisition.score = 80;
      insights.acquisition.verdict = `CPA within target. Acquisition is sustainable.`;
    } else {
      insights.acquisition.status = 'warning';
      insights.acquisition.score = 50;
      insights.acquisition.issues.push(`CPA above target`);
      insights.acquisition.verdict = `CPA exceeds target - optimize before scaling.`;
      insights.acquisition.actions.push('Review underperforming ad groups and pause low converters');
    }
  } else {
    insights.acquisition.status = 'no_data';
    insights.acquisition.metrics = { spend: 0, conversions: ga4.newUsers || 0 };
    insights.acquisition.verdict = 'No paid acquisition data available.';
  }

  // === ENGAGEMENT ANALYSIS (User-Centric) ===
  // Session-based rate (GA4 default) - less useful
  const sessionEngagementRate = ga4.engagementRate || 0;
  const avgSessionDuration = ga4.averageSessionDuration || 0;
  const pagesPerSession = ga4.screenPageViewsPerSession || 0;
  const bounceRate = ga4.bounceRate || 0;

  // User-centric metrics - what we actually care about
  const activeUsers = ga4.activeUsers || 1;
  const engagedSessions = ga4.engagedSessions || 0;
  const totalSessions = ga4.sessions || 0;
  const totalEngagementTime = ga4.userEngagementDuration || 0;

  // KEY USER-CENTRIC METRICS
  const sessionsPerUser = totalSessions / activeUsers;
  const engagedSessionsPerUser = engagedSessions / activeUsers;
  const engagementTimePerUser = totalEngagementTime / activeUsers; // in seconds
  const userEngagementRate = engagedSessionsPerUser; // How many quality sessions per user?

  insights.engagement.metrics = {
    // User-centric (what matters)
    sessionsPerUser,
    engagedSessionsPerUser,
    engagementTimePerUser,
    engagementMinutesPerUser: engagementTimePerUser / 60,

    // Session-based (for reference)
    sessionEngagementRate,
    avgSessionDuration,
    pagesPerSession,
    bounceRate,
    engagedSessions,
    totalSessions,
    activeUsers,
  };

  // Evaluate based on USER engagement, not session engagement
  // Good user engagement: >2 engaged sessions per user, >5 min total time
  if (engagedSessionsPerUser >= 3 && engagementTimePerUser >= 300) {
    insights.engagement.status = 'excellent';
    insights.engagement.score = 100;
    insights.engagement.verdict = `Strong user engagement: ${engagedSessionsPerUser.toFixed(1)} engaged sessions/user, ${(engagementTimePerUser/60).toFixed(0)} min avg time invested.`;
  } else if (engagedSessionsPerUser >= 2 || engagementTimePerUser >= 180) {
    insights.engagement.status = 'healthy';
    insights.engagement.score = 80;
    insights.engagement.verdict = `Decent engagement: ${engagedSessionsPerUser.toFixed(1)} engaged sessions/user. Users are exploring.`;
  } else if (engagedSessionsPerUser >= 1) {
    insights.engagement.status = 'warning';
    insights.engagement.score = 50;
    insights.engagement.issues.push(`Only ${engagedSessionsPerUser.toFixed(1)} engaged sessions per user`);
    insights.engagement.verdict = `Users engage once but don't go deeper. ${engagedSessionsPerUser.toFixed(1)} engaged sessions/user.`;
    insights.engagement.actions.push('Improve depth of experience - give users reasons to explore');
    insights.engagement.actions.push('Add progressive value discovery in product');
  } else {
    insights.engagement.status = 'critical';
    insights.engagement.score = 20;
    insights.engagement.issues.push(`Critical: Only ${engagedSessionsPerUser.toFixed(2)} engaged sessions per user`);
    insights.engagement.verdict = `Users are not engaging meaningfully. Most leave without value.`;
    insights.engagement.actions.push('URGENT: Review time-to-value in onboarding');
    insights.engagement.actions.push('Investigate: Are users reaching core feature?');
  }

  // === RETENTION ANALYSIS (THE CRITICAL ONE) ===
  const dauMau = ga4.dauPerMau || 0;
  const dauWau = ga4.dauPerWau || 0;
  const wauMau = ga4.wauPerMau || 0;

  insights.retention.metrics = {
    dauPerMau: dauMau,
    dauPerWau: dauWau,
    wauPerMau: wauMau,
    stickiness: (dauMau * 0.5 + dauWau * 0.3 + wauMau * 0.2),
  };

  // Retention trend from WoW
  const retentionTrend = wow.dauPerMau ? wow.dauPerMau.changePercent : 0;

  if (dauMau >= 0.20) {
    insights.retention.status = 'excellent';
    insights.retention.score = 100;
    insights.retention.verdict = `${(dauMau*100).toFixed(1)}% DAU/MAU indicates strong product-market fit. Users have a habit.`;
  } else if (dauMau >= targetDAUMAU) {
    insights.retention.status = 'healthy';
    insights.retention.score = 80;
    insights.retention.verdict = `Retention meets target. Product has baseline stickiness.`;
  } else if (dauMau >= targetDAUMAU * 0.5) {
    insights.retention.status = 'warning';
    insights.retention.score = 50;
    insights.retention.issues.push(`DAU/MAU of ${(dauMau*100).toFixed(1)}% is below the ${(targetDAUMAU*100).toFixed(0)}% target`);
    insights.retention.verdict = `Users try the product but don't return. This is the bottleneck.`;
    insights.retention.actions.push('Implement push/email re-engagement campaign');
    insights.retention.actions.push('Add daily value hooks (streaks, fresh content, notifications)');
  } else {
    insights.retention.status = 'critical';
    insights.retention.score = 20;
    insights.retention.issues.push(`Critical: Only ${(dauMau*100).toFixed(1)}% of users return daily`);
    insights.retention.verdict = `CRITICAL: Users are not coming back. Scaling acquisition will waste money.`;
    insights.retention.actions.push('STOP: Do not scale acquisition until retention improves');
    insights.retention.actions.push('INVESTIGATE: Conduct 10 user interviews this week');
    insights.retention.actions.push('HYPOTHESIS: List top 3 reasons users might not return');
    insights.retention.actions.push('EXPERIMENT: Run one retention experiment before next report');
  }

  // === TRAJECTORY ANALYSIS ===
  if (trajectory && trajectory.weeks && trajectory.weeks.length > 0) {
    const growthRate = trajectory.growthRate || 0;
    insights.trajectory.trend = trajectory.trend;

    if (growthRate > 0.20) {
      insights.trajectory.verdict = `Strong growth: ${(growthRate*100).toFixed(0)}% over 30 days. Trajectory is positive.`;
      insights.trajectory.forecast = `At this rate, you'll 2x in ~${Math.round(70/Math.abs(growthRate*100))} weeks.`;
    } else if (growthRate > 0.05) {
      insights.trajectory.verdict = `Moderate growth: ${(growthRate*100).toFixed(0)}% over 30 days.`;
      insights.trajectory.forecast = `Growth is positive but not hypergrowth yet.`;
    } else if (growthRate > -0.05) {
      insights.trajectory.verdict = `Flat: ${(growthRate*100).toFixed(0)}% change over 30 days.`;
      insights.trajectory.forecast = `You're maintaining but not growing. Need to find new growth levers.`;
    } else {
      insights.trajectory.verdict = `Declining: ${(growthRate*100).toFixed(0)}% over 30 days. Urgent attention needed.`;
      insights.trajectory.forecast = `At this rate, you'll lose half your users in ~${Math.round(70/Math.abs(growthRate*100))} weeks.`;
    }
  }

  // === UNIT ECONOMICS ===
  const spend = ads.totals?.spend || 0;
  const conversions = ads.totals?.conversions || 1;
  const userEngagementDepth = insights.engagement.metrics.engagedSessionsPerUser || 1;

  insights.unitEconomics.metrics = {
    costPerInstall: spend > 0 ? spend / conversions : 0,
    costPerEngagedUser: spend > 0 ? spend / (conversions * Math.min(userEngagementDepth, 1)) : 0, // Adjusted for users who engage at least once
    costPerRetainedUser: spend > 0 && dauMau > 0 ? spend / (conversions * dauMau) : 0,
    acquisitionToRetention: dauMau,
  };

  if (spend > 0 && dauMau > 0) {
    const cpru = insights.unitEconomics.metrics.costPerRetainedUser;
    insights.unitEconomics.verdict = `You pay $${insights.unitEconomics.metrics.costPerInstall.toFixed(2)} per install, but $${cpru.toFixed(2)} per retained user. ${(dauMau*100).toFixed(0)}% of acquired users stick.`;
  }

  // === OVERALL HEALTH & SCALING DECISION ===
  const scores = [
    insights.acquisition.score,
    insights.engagement.score,
    insights.retention.score,
  ].filter(s => s > 0);

  insights.overall.score = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  // Determine if ready to scale
  const acquisitionReady = insights.acquisition.status === 'excellent' || insights.acquisition.status === 'healthy';
  const engagementReady = insights.engagement.status === 'excellent' || insights.engagement.status === 'healthy';
  const retentionReady = insights.retention.status === 'excellent' || insights.retention.status === 'healthy';

  if (acquisitionReady && engagementReady && retentionReady) {
    insights.overall.status = 'healthy';
    insights.overall.readyToScale = true;
    insights.overall.summary = 'All pillars healthy - ready to scale acquisition';
    insights.executiveSummary.push('GREEN LIGHT: Funnel is working. Scale acquisition budget.');
  } else if (insights.retention.status === 'critical') {
    insights.overall.status = 'critical';
    insights.overall.readyToScale = false;
    insights.overall.blockingIssue = 'retention';
    insights.overall.summary = 'BLOCKED: Fix retention before scaling';
    insights.executiveSummary.push('RED FLAG: Retention is critical. Do NOT increase ad spend.');
    insights.executiveSummary.push(`Only ${(dauMau*100).toFixed(1)}% of users return. Fix this first.`);
  } else if (insights.retention.status === 'warning') {
    insights.overall.status = 'warning';
    insights.overall.readyToScale = false;
    insights.overall.blockingIssue = 'retention';
    insights.overall.summary = 'Caution: Retention needs improvement before scaling';
    insights.executiveSummary.push('CAUTION: Retention below target. Scaling will be inefficient.');
  } else {
    insights.overall.status = 'unknown';
    insights.overall.summary = 'Insufficient data for scaling decision';
  }

  // Add trajectory context to executive summary
  if (trajectory && trajectory.trend) {
    if (trajectory.trend === 'growing') {
      insights.executiveSummary.push(`TRAJECTORY: Growing ${(trajectory.growthRate*100).toFixed(0)}% over 30 days`);
    } else if (trajectory.trend === 'declining') {
      insights.executiveSummary.push(`WARNING: Declining ${(trajectory.growthRate*100).toFixed(0)}% over 30 days`);
    }
  }

  // === PRIORITIZED ACTIONS ===
  // Retention actions are always highest priority if there are issues
  if (insights.retention.status === 'critical' || insights.retention.status === 'warning') {
    insights.prioritizedActions = [
      ...insights.retention.actions.map(a => ({ priority: 'critical', area: 'retention', action: a })),
    ];
  }

  // Then add other actions
  insights.prioritizedActions.push(
    ...insights.engagement.actions.map(a => ({ priority: 'high', area: 'engagement', action: a })),
    ...insights.acquisition.actions.map(a => ({ priority: 'medium', area: 'acquisition', action: a })),
  );

  return insights;
}

/**
 * Main analysis function that combines all data sources
 */
async function analyzeMarketing(ga4, ads, targets = {}, options = {}) {
  const { propertyId, previousPeriodGa4, trajectory, cohorts } = options;

  // Calculate WoW if we have previous period data
  const wow = previousPeriodGa4 ? calculateWoW(ga4, previousPeriodGa4) : {};

  // Generate strategic insights
  const insights = generateStrategicInsights(ga4, ads, trajectory, cohorts, wow, targets);

  // Add WoW data
  insights.weekOverWeek = wow;

  return insights;
}

/**
 * Generate the Marketing Intelligence HTML Report
 */
function generateMarketingReport(data) {
  const { ga4, ads, insights, config, dates, trajectory, previousPeriodGa4 } = data;
  const reportDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const formatMoney = (n) => `$${(n || 0).toFixed(2)}`;
  const formatNum = (n) => n >= 1000 ? (n/1000).toFixed(1) + 'K' : Math.round(n || 0);
  const formatPct = (n) => `${((n || 0) * 100).toFixed(1)}%`;
  const formatChange = (n) => {
    if (!n) return '';
    const sign = n >= 0 ? '+' : '';
    return `${sign}${n.toFixed(1)}%`;
  };

  const statusColor = (status) => {
    const colors = {
      excellent: '#10B981', healthy: '#10B981', warning: '#F59E0B',
      critical: '#EF4444', unknown: '#6B7280', no_data: '#6B7280',
    };
    return colors[status] || '#6B7280';
  };

  const statusIcon = (status) => {
    const icons = { excellent: '🔥', healthy: '✅', warning: '⚠️', critical: '🚨', unknown: '❓', no_data: '📊' };
    return icons[status] || '❓';
  };

  const changeClass = (val) => val >= 0 ? 'good' : 'bad';
  const changeArrow = (val) => val >= 0 ? '↑' : '↓';

  // Chart data
  const dailyLabels = (ga4.daily || []).map(d => d.date.slice(4, 6) + '/' + d.date.slice(6));
  const dailyUsers = (ga4.daily || []).map(d => d.activeUsers);
  const dailyNewUsers = (ga4.daily || []).map(d => d.newUsers);

  // Trajectory chart data
  const trajectoryLabels = (trajectory?.weeks || []).map(w => {
    const parts = w.week.split('');
    return parts.slice(-4).join('');
  });
  const trajectoryUsers = (trajectory?.weeks || []).map(w => w.activeUsers);

  // WoW data
  const wow = insights.weekOverWeek || {};

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.propertyName} Growth Intelligence Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --primary: #4F46E5; --success: #10B981; --warning: #F59E0B; --danger: #EF4444;
      --gray-50: #F9FAFB; --gray-100: #F3F4F6; --gray-200: #E5E7EB;
      --gray-600: #4B5563; --gray-800: #1F2937; --gray-900: #111827;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--gray-50); color: var(--gray-800); line-height: 1.6; }
    .container { max-width: 1400px; margin: 0 auto; padding: 2rem; }

    header { background: linear-gradient(135deg, #1e1b4b, #4338ca); color: white; padding: 2rem; border-radius: 1rem; margin-bottom: 2rem; }
    header h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
    .header-meta { display: flex; gap: 2rem; margin-top: 1rem; opacity: 0.9; font-size: 0.9rem; flex-wrap: wrap; }

    /* Executive Summary */
    .exec-summary { background: linear-gradient(135deg, #fef3c7, #fde68a); border-radius: 1rem; padding: 1.5rem; margin-bottom: 2rem; border-left: 4px solid #F59E0B; }
    .exec-summary.critical { background: linear-gradient(135deg, #fee2e2, #fecaca); border-left-color: #EF4444; }
    .exec-summary.healthy { background: linear-gradient(135deg, #d1fae5, #a7f3d0); border-left-color: #10B981; }
    .exec-summary h2 { font-size: 1.25rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; }
    .exec-summary ul { list-style: none; }
    .exec-summary li { padding: 0.5rem 0; font-size: 1.1rem; font-weight: 500; }
    .exec-summary .verdict { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(0,0,0,0.1); font-size: 0.95rem; }

    /* Scaling Decision Banner */
    .scale-decision { display: flex; align-items: center; justify-content: center; gap: 1rem; padding: 1.5rem; border-radius: 1rem; margin-bottom: 2rem; color: white; font-size: 1.25rem; font-weight: 600; }

    /* KPI Grid with WoW */
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; }
    .kpi-card { background: white; border-radius: 1rem; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .kpi-label { font-size: 0.75rem; color: var(--gray-600); text-transform: uppercase; letter-spacing: 0.05em; }
    .kpi-value { font-size: 2rem; font-weight: 700; margin: 0.25rem 0; }
    .kpi-change { font-size: 0.875rem; display: flex; align-items: center; gap: 0.25rem; }
    .kpi-change.good { color: var(--success); }
    .kpi-change.bad { color: var(--danger); }
    .kpi-wow { font-size: 0.75rem; color: var(--gray-600); margin-top: 0.25rem; }

    /* Pillars */
    .pillars { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; margin-bottom: 2rem; }
    .pillar { background: white; border-radius: 1rem; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .pillar-header { padding: 1rem 1.5rem; color: white; display: flex; align-items: center; gap: 0.75rem; }
    .pillar-header h3 { font-size: 1rem; font-weight: 600; }
    .pillar-body { padding: 1.5rem; }
    .pillar-verdict { font-size: 0.9rem; color: var(--gray-600); margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--gray-100); font-style: italic; }
    .pillar-metric { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--gray-100); }
    .pillar-metric:last-child { border-bottom: none; }
    .pillar-issues { margin-top: 1rem; padding: 1rem; background: #FEF2F2; border-radius: 0.5rem; }
    .pillar-actions { margin-top: 1rem; }
    .pillar-action { padding: 0.5rem; background: var(--gray-100); border-radius: 0.25rem; margin-bottom: 0.5rem; font-size: 0.875rem; }

    /* Trajectory Section */
    .trajectory-section { background: white; border-radius: 1rem; padding: 1.5rem; margin-bottom: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .trajectory-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .trajectory-verdict { font-size: 0.95rem; color: var(--gray-600); }
    .trajectory-forecast { font-size: 0.875rem; color: var(--primary); font-weight: 500; margin-top: 0.5rem; }

    .section { margin-bottom: 2rem; }
    .section-title { font-size: 1.125rem; font-weight: 600; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; }

    .card { background: white; border-radius: 1rem; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .chart-container { height: 300px; position: relative; }
    .chart-container-small { height: 200px; position: relative; }

    .unit-economics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
    .unit-card { text-align: center; padding: 1.5rem; background: linear-gradient(135deg, var(--gray-50), white); border-radius: 1rem; border: 1px solid var(--gray-200); }
    .unit-value { font-size: 1.75rem; font-weight: 700; color: var(--primary); }
    .unit-label { font-size: 0.75rem; color: var(--gray-600); margin-top: 0.25rem; }

    .priority-actions { background: linear-gradient(135deg, #fef3c7, #fde68a); border-radius: 1rem; padding: 1.5rem; }
    .priority-actions.critical { background: linear-gradient(135deg, #fee2e2, #fecaca); }
    .priority-actions h3 { color: #92400e; margin-bottom: 1rem; }
    .priority-actions.critical h3 { color: #991B1B; }
    .action-item { display: flex; gap: 1rem; padding: 0.75rem; background: white; border-radius: 0.5rem; margin-bottom: 0.5rem; align-items: center; }
    .action-priority { padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 600; }
    .action-priority.critical { background: #FEE2E2; color: #991B1B; }
    .action-priority.high { background: #FEE2E2; color: #991B1B; }
    .action-priority.medium { background: #FEF3C7; color: #92400E; }
    .action-area { font-size: 0.75rem; color: var(--gray-600); text-transform: uppercase; }

    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th, .data-table td { padding: 0.75rem; text-align: left; border-bottom: 1px solid var(--gray-200); }
    .data-table th { font-size: 0.75rem; color: var(--gray-600); text-transform: uppercase; }

    footer { text-align: center; padding: 2rem; color: var(--gray-600); font-size: 0.875rem; }

    @media (max-width: 1024px) { .kpi-grid, .pillars, .unit-economics { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 640px) { .kpi-grid, .pillars, .unit-economics { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📊 ${config.propertyName} Growth Intelligence</h1>
      <p>AI-Powered Weekly Analysis • Acquisition × Engagement × Retention</p>
      <div class="header-meta">
        <span>📅 ${reportDate}</span>
        <span>📆 Period: ${dates.start} to ${dates.end}</span>
        <span>🎯 Target CPA: ${formatMoney(config.targetCPA)}</span>
        <span>🎯 Target DAU/MAU: ≥10%</span>
      </div>
    </header>

    <!-- Executive Summary - The Honest Assessment -->
    <div class="exec-summary ${insights.overall.status}">
      <h2>${statusIcon(insights.overall.status)} Executive Summary</h2>
      <ul>
        ${insights.executiveSummary.map(s => `<li>${s}</li>`).join('')}
      </ul>

      <div class="verdict" style="margin-top: 1.5rem; padding-top: 1rem; border-top: 2px solid rgba(0,0,0,0.1);">
        <strong style="font-size: 1.1rem;">The Honest Assessment:</strong>
        <div style="margin-top: 0.75rem; line-height: 1.8;">
          ${insights.acquisition.status !== 'no_data' ? `
            <div><strong>Acquisition:</strong> ${insights.acquisition.verdict}</div>
          ` : ''}
          <div><strong>Engagement:</strong> ${insights.engagement.verdict}</div>
          <div><strong>Retention:</strong> ${insights.retention.verdict}</div>
          ${insights.trajectory.verdict ? `
            <div><strong>Trajectory:</strong> ${insights.trajectory.verdict}</div>
          ` : ''}
        </div>
      </div>

      ${insights.overall.blockingIssue ? `
        <div style="margin-top: 1rem; padding: 1rem; background: rgba(0,0,0,0.05); border-radius: 0.5rem;">
          <strong>⛔ Scaling Decision:</strong> ${insights.overall.readyToScale ? 'Ready to scale' : `BLOCKED by ${insights.overall.blockingIssue.toUpperCase()}`}
        </div>
      ` : ''}
    </div>

    <!-- Scaling Decision Banner -->
    <div class="scale-decision" style="background: ${insights.overall.readyToScale ? '#10B981' : statusColor(insights.overall.status)}">
      <span style="font-size: 2rem;">${insights.overall.readyToScale ? '🚀' : statusIcon(insights.overall.status)}</span>
      <span>${insights.overall.summary}</span>
      <span style="opacity: 0.8; font-size: 1rem;">(Score: ${insights.overall.score.toFixed(0)}/100)</span>
    </div>

    <!-- KPIs with WoW -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Ad Spend (7d)</div>
        <div class="kpi-value">${formatMoney(insights.acquisition.metrics.spend || 0)}</div>
        <div class="kpi-change">${formatNum(insights.acquisition.metrics.conversions || 0)} conversions</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Cost per Install</div>
        <div class="kpi-value">${formatMoney(insights.acquisition.metrics.cpa || 0)}</div>
        <div class="kpi-change ${(insights.acquisition.metrics.cpa || 0) <= config.targetCPA ? 'good' : 'bad'}">
          Target: ${formatMoney(config.targetCPA)}
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Engaged Sessions/User</div>
        <div class="kpi-value">${(insights.engagement.metrics.engagedSessionsPerUser || 0).toFixed(1)}</div>
        <div class="kpi-change">${(insights.engagement.metrics.engagementMinutesPerUser || 0).toFixed(0)} min avg time/user</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">DAU/MAU (Retention)</div>
        <div class="kpi-value">${formatPct(insights.retention.metrics.dauPerMau || 0)}</div>
        <div class="kpi-change ${(insights.retention.metrics.dauPerMau || 0) >= 0.10 ? 'good' : 'bad'}">
          Target: ≥10%
        </div>
        ${wow.dauPerMau ? `
          <div class="kpi-wow">${changeArrow(wow.dauPerMau.changePercent)} ${formatChange(wow.dauPerMau.changePercent)} vs last week</div>
        ` : ''}
      </div>
    </div>

    <!-- 30-Day Trajectory -->
    ${trajectory && trajectory.weeks && trajectory.weeks.length > 0 ? `
    <div class="trajectory-section">
      <div class="trajectory-header">
        <div class="section-title">📈 30-Day Trajectory</div>
        <div style="text-align: right;">
          <div class="trajectory-verdict">${insights.trajectory.verdict}</div>
          <div class="trajectory-forecast">${insights.trajectory.forecast}</div>
        </div>
      </div>
      <div class="chart-container-small">
        <canvas id="trajectoryChart"></canvas>
      </div>
    </div>
    ` : ''}

    <!-- Three Pillars -->
    <div class="pillars">
      <!-- Acquisition Pillar -->
      <div class="pillar">
        <div class="pillar-header" style="background: ${statusColor(insights.acquisition.status)}">
          <span style="font-size: 1.5rem;">${statusIcon(insights.acquisition.status)}</span>
          <h3>ACQUISITION</h3>
        </div>
        <div class="pillar-body">
          <div class="pillar-verdict">${insights.acquisition.verdict}</div>
          <div class="pillar-metric"><span>Spend</span><strong>${formatMoney(insights.acquisition.metrics.spend || 0)}</strong></div>
          <div class="pillar-metric"><span>Conversions</span><strong>${formatNum(insights.acquisition.metrics.conversions || 0)}</strong></div>
          <div class="pillar-metric"><span>CPA</span><strong>${formatMoney(insights.acquisition.metrics.cpa || 0)}</strong></div>
          <div class="pillar-metric"><span>vs Target</span><strong>${((insights.acquisition.metrics.cpaEfficiency || 0) * 100).toFixed(0)}% efficient</strong></div>
          ${insights.acquisition.actions.length > 0 ? `
            <div class="pillar-actions">
              ${insights.acquisition.actions.map(a => `<div class="pillar-action">→ ${a}</div>`).join('')}
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Engagement Pillar (User-Centric) -->
      <div class="pillar">
        <div class="pillar-header" style="background: ${statusColor(insights.engagement.status)}">
          <span style="font-size: 1.5rem;">${statusIcon(insights.engagement.status)}</span>
          <h3>ENGAGEMENT</h3>
        </div>
        <div class="pillar-body">
          <div class="pillar-verdict">${insights.engagement.verdict}</div>
          <div class="pillar-metric"><span>Engaged Sessions/User</span><strong>${(insights.engagement.metrics.engagedSessionsPerUser || 0).toFixed(1)}</strong></div>
          <div class="pillar-metric"><span>Time per User</span><strong>${(insights.engagement.metrics.engagementMinutesPerUser || 0).toFixed(0)} min</strong></div>
          <div class="pillar-metric"><span>Sessions/User</span><strong>${(insights.engagement.metrics.sessionsPerUser || 0).toFixed(1)}</strong></div>
          <div class="pillar-metric"><span>Session Eng. Rate</span><strong>${formatPct(insights.engagement.metrics.sessionEngagementRate || 0)}</strong></div>
          ${insights.engagement.issues.length > 0 ? `
            <div class="pillar-issues warning">
              ${insights.engagement.issues.map(i => `<div>⚠️ ${i}</div>`).join('')}
            </div>
          ` : ''}
          ${insights.engagement.actions.length > 0 ? `
            <div class="pillar-actions">
              ${insights.engagement.actions.map(a => `<div class="pillar-action">→ ${a}</div>`).join('')}
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Retention Pillar -->
      <div class="pillar">
        <div class="pillar-header" style="background: ${statusColor(insights.retention.status)}">
          <span style="font-size: 1.5rem;">${statusIcon(insights.retention.status)}</span>
          <h3>RETENTION</h3>
        </div>
        <div class="pillar-body">
          <div class="pillar-verdict">${insights.retention.verdict}</div>
          <div class="pillar-metric"><span>DAU/MAU</span><strong>${formatPct(insights.retention.metrics.dauPerMau || 0)}</strong></div>
          <div class="pillar-metric"><span>DAU/WAU</span><strong>${formatPct(insights.retention.metrics.dauPerWau || 0)}</strong></div>
          <div class="pillar-metric"><span>WAU/MAU</span><strong>${formatPct(insights.retention.metrics.wauPerMau || 0)}</strong></div>
          ${insights.retention.issues.length > 0 ? `
            <div class="pillar-issues">
              ${insights.retention.issues.map(i => `<div>🚨 ${i}</div>`).join('')}
            </div>
          ` : ''}
          ${insights.retention.actions.length > 0 ? `
            <div class="pillar-actions">
              ${insights.retention.actions.map(a => `<div class="pillar-action">→ ${a}</div>`).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    </div>

    <!-- Unit Economics -->
    <div class="section">
      <div class="section-title">💰 Unit Economics</div>
      <div class="unit-economics">
        <div class="unit-card">
          <div class="unit-value">${formatMoney(insights.unitEconomics.metrics.costPerInstall || 0)}</div>
          <div class="unit-label">Cost per Install</div>
        </div>
        <div class="unit-card">
          <div class="unit-value">${formatMoney(insights.unitEconomics.metrics.costPerEngagedUser || 0)}</div>
          <div class="unit-label">Cost per Engaged User</div>
        </div>
        <div class="unit-card">
          <div class="unit-value">${formatMoney(insights.unitEconomics.metrics.costPerRetainedUser || 0)}</div>
          <div class="unit-label">Cost per Retained User</div>
        </div>
        <div class="unit-card">
          <div class="unit-value">${formatPct(insights.unitEconomics.metrics.acquisitionToRetention || 0)}</div>
          <div class="unit-label">Acquisition → Retention</div>
        </div>
      </div>
      ${insights.unitEconomics.verdict ? `
        <div style="text-align: center; margin-top: 1rem; color: var(--gray-600); font-size: 0.9rem;">
          ${insights.unitEconomics.verdict}
        </div>
      ` : ''}
    </div>

    <!-- The Bottom Line - Shareable Summary -->
    <div class="section">
      <div class="card" style="background: linear-gradient(135deg, #1e1b4b, #4338ca); color: white; padding: 2rem;">
        <h3 style="margin-bottom: 1rem; font-size: 1.25rem;">📋 The Bottom Line</h3>
        <div style="font-size: 1.1rem; line-height: 1.8;">
          <p><strong>Where we are:</strong> Acquiring users efficiently ($${(insights.acquisition.metrics.cpa || 0).toFixed(2)} CPA) but losing them fast (${formatPct(insights.retention.metrics.dauPerMau || 0)} return daily).</p>
          <p style="margin-top: 0.75rem;"><strong>The math:</strong> ${formatNum(insights.acquisition.metrics.conversions || 0)} installs × ${formatPct(insights.retention.metrics.dauPerMau || 0)} retention = ~${formatNum((insights.acquisition.metrics.conversions || 0) * (insights.retention.metrics.dauPerMau || 0))} retained users from this week's spend.</p>
          <p style="margin-top: 0.75rem;"><strong>What this means:</strong> ${insights.overall.readyToScale
            ? 'Funnel is healthy. Scaling acquisition will grow the business.'
            : `Every dollar on acquisition loses ${((1 - (insights.retention.metrics.dauPerMau || 0)) * 100).toFixed(0)}% of users. Fix retention first.`}</p>
        </div>
      </div>
    </div>

    <!-- Priority Actions -->
    ${insights.prioritizedActions.length > 0 ? `
    <div class="section">
      <div class="priority-actions ${insights.retention.status === 'critical' ? 'critical' : ''}">
        <h3>🎯 This Week's Priority Actions</h3>
        ${insights.prioritizedActions.slice(0, 5).map(a => `
          <div class="action-item">
            <span class="action-priority ${a.priority}">${a.priority.toUpperCase()}</span>
            <span class="action-area">${a.area}</span>
            <span>${a.action}</span>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <!-- Team Learnings Section -->
    <div class="section">
      <div class="card" style="border: 2px dashed var(--gray-200); background: var(--gray-50);">
        <h3 style="color: var(--gray-600); margin-bottom: 1rem;">📝 Team Learnings & Notes</h3>
        <div style="color: var(--gray-600); font-size: 0.9rem;">
          <p><em>Space for weekly learnings, experiment results, and team notes.</em></p>
          <div style="margin-top: 1rem; padding: 1rem; background: white; border-radius: 0.5rem; min-height: 100px;">
            <p style="color: var(--gray-400);">Add your learnings here after the Thursday review...</p>
            <ul style="margin-top: 0.5rem; margin-left: 1.5rem; color: var(--gray-500);">
              <li>What experiments did we run?</li>
              <li>What did we learn about our users?</li>
              <li>What's our hypothesis for next week?</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- Daily Trend -->
    <div class="section">
      <div class="section-title">📊 This Week's Daily Trend</div>
      <div class="card">
        <div class="chart-container">
          <canvas id="trendChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Traffic Sources -->
    <div class="section">
      <div class="section-title">🌐 Traffic Sources</div>
      <div class="card">
        <table class="data-table">
          <thead>
            <tr><th>Channel</th><th>Users</th><th>Sessions</th><th>Engagement</th></tr>
          </thead>
          <tbody>
            ${(ga4.sources || []).slice(0, 8).map(s => `
              <tr>
                <td><strong>${s.channel}</strong></td>
                <td>${formatNum(s.users)}</td>
                <td>${formatNum(s.sessions)}</td>
                <td>${formatPct(s.engagementRate)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Campaign Performance -->
    ${ads.campaigns && ads.campaigns.length > 0 ? `
    <div class="section">
      <div class="section-title">📣 Campaign Performance</div>
      <div class="card">
        <table class="data-table">
          <thead>
            <tr><th>Campaign</th><th>Spend</th><th>Conv.</th><th>CPA</th></tr>
          </thead>
          <tbody>
            ${ads.campaigns.filter(c => c.spend > 0).map(c => `
              <tr>
                <td><strong>${c.name.length > 40 ? c.name.slice(0, 40) + '...' : c.name}</strong></td>
                <td>${formatMoney(c.spend)}</td>
                <td>${formatNum(c.conversions)}</td>
                <td>${formatMoney(c.conversions > 0 ? c.spend / c.conversions : 0)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}

    <footer>
      <p>Growth Intelligence Report • Generated ${new Date().toISOString()}</p>
      <p>Powered by AI Growth Analyst • Google Ads + GA4 Data API</p>
    </footer>
  </div>

  <script>
    // Daily trend chart
    new Chart(document.getElementById('trendChart').getContext('2d'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(dailyLabels)},
        datasets: [{
          label: 'Active Users',
          data: ${JSON.stringify(dailyUsers)},
          borderColor: '#4F46E5',
          backgroundColor: 'rgba(79, 70, 229, 0.1)',
          fill: true,
          tension: 0.3
        }, {
          label: 'New Users',
          data: ${JSON.stringify(dailyNewUsers)},
          borderColor: '#10B981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
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

    // Trajectory chart
    ${trajectory && trajectory.weeks && trajectory.weeks.length > 0 ? `
    new Chart(document.getElementById('trajectoryChart').getContext('2d'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(trajectoryLabels)},
        datasets: [{
          label: 'Weekly Active Users',
          data: ${JSON.stringify(trajectoryUsers)},
          borderColor: '#4F46E5',
          backgroundColor: 'rgba(79, 70, 229, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: '#4F46E5',
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: false } }
      }
    });
    ` : ''}
  </script>
</body>
</html>`;
}

export {
  fetchGA4Metrics,
  fetchCohortRetention,
  fetchTrajectory,
  fetchGoogleAdsData,
  analyzeMarketing,
  generateMarketingReport,
};

export default {
  fetchGA4Metrics,
  fetchCohortRetention,
  fetchTrajectory,
  fetchGoogleAdsData,
  analyzeMarketing,
  generateMarketingReport,
};
