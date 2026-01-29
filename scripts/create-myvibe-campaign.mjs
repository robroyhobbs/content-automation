#!/usr/bin/env node
/**
 * MyVibe Campaign Creator
 *
 * Executes the full campaign setup via MCP when the account is ready.
 * Run: node scripts/create-myvibe-campaign.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MCP_PATH = '/Users/robroyhobbs/work/google-ads-automation/mcp-server';
const PYTHON_PATH = `${MCP_PATH}/.venv/bin/python3`;
const CUSTOMER_ID = '1749226866';

// Campaign configuration from blueprint
const CONFIG = {
  budget: {
    name: 'MyVibe Daily Budget',
    amountMicros: 50000000 // $50
  },
  campaign: {
    name: 'MyVibe - Search High Intent',
    targetCpaMicros: 2000000 // $2
  },
  adGroups: [
    {
      name: 'AI Creation Publishing',
      keywords: [
        'publish AI website',
        'share AI creation',
        'deploy AI app',
        'host AI generated site',
        'publish claude artifact',
        'share chatgpt creation'
      ]
    },
    {
      name: 'Vibe Coding',
      keywords: [
        'vibe coding publish',
        'vibe coding deploy',
        'share vibe code',
        'publish vibe project'
      ]
    },
    {
      name: 'Competitor Alternative',
      keywords: [
        'lovable alternative',
        'v0 alternative',
        'bolt.new alternative',
        'vercel alternative no code'
      ]
    },
    {
      name: 'No-Code Publishing',
      keywords: [
        'publish website no code',
        'deploy website without coding',
        'share website instantly',
        'one click website publish'
      ]
    }
  ],
  headlines: [
    'Share Your AI Creations',
    'Live in Seconds',
    'No DevOps Required',
    'Your Vibes, Live Now',
    'From Chat to Website',
    'Publish Instantly Free',
    'AI to Live Site',
    'One Click Publishing',
    'Share Your Vibe',
    'No Code Needed',
    'Works with Claude',
    'Works with ChatGPT',
    'Works with Lovable',
    'Your Data Stays Yours',
    'Free to Start'
  ],
  descriptions: [
    'Turn any AI creation into a live website. No deploy, no DevOps. Just share. Free to start.',
    'Made something in Claude or ChatGPT? Share it with the world in seconds. Try free today.',
    'The easiest way to publish AI creations. Works with Lovable, v0, Bolt and more. No code.',
    'Stop letting AI creations die in browser tabs. Make them live and shareable instantly.'
  ],
  finalUrl: 'https://myvibe.so',
  locations: ['2840', '2826', '2124', '2036'], // US, UK, CA, AU
  negativeKeywords: [
    'job', 'jobs', 'hiring', 'career', 'salary',
    'tutorial', 'course', 'learn how to code',
    'completely free forever', 'download app'
  ]
};

async function callMCP(functionName, args) {
  return new Promise((resolve, reject) => {
    const argsStr = Object.entries(args)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');

    const code = `
import asyncio
import sys
sys.path.insert(0, '${MCP_PATH}')
from dotenv import load_dotenv
import os
os.chdir('${MCP_PATH}')
load_dotenv()
from google_ads_server import ${functionName}

async def main():
    result = await ${functionName}(${argsStr})
    print(result)

asyncio.run(main())
`;

    const child = spawn(PYTHON_PATH, ['-c', code], {
      cwd: MCP_PATH,
      env: { ...process.env, PYTHONPATH: MCP_PATH }
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('close', code => {
      if (stdout.includes('Error')) {
        reject(new Error(stdout));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

async function checkAccountStatus() {
  console.log('Checking MyVibe account status...');
  try {
    const result = await callMCP('get_account_currency', { customer_id: CUSTOMER_ID });
    if (result.includes('Error') || result.includes('NOT_ENABLED')) {
      console.log('❌ Account not yet enabled');
      return false;
    }
    console.log('✅ Account is enabled!');
    console.log(result);
    return true;
  } catch (e) {
    console.log('❌ Account not ready:', e.message.substring(0, 100));
    return false;
  }
}

async function createCampaign() {
  console.log('\n' + '='.repeat(60));
  console.log('CREATING MYVIBE CAMPAIGN');
  console.log('='.repeat(60));

  // Step 1: Create Budget
  console.log('\n[1/7] Creating budget...');
  const budgetResult = await callMCP('create_campaign_budget', {
    customer_id: CUSTOMER_ID,
    budget_name: CONFIG.budget.name,
    amount_micros: CONFIG.budget.amountMicros
  });
  console.log(budgetResult);

  // Extract budget resource name
  const budgetMatch = budgetResult.match(/Resource: (customers\/\d+\/campaignBudgets\/\d+)/);
  if (!budgetMatch) throw new Error('Failed to create budget');
  const budgetResource = budgetMatch[1];

  // Step 2: Create Campaign
  // Note: Using Maximize Conversions for new account (Target CPA requires conversion history)
  // Once we have 15+ conversions, we can switch to Target CPA bidding
  console.log('\n[2/7] Creating campaign (Maximize Conversions - will switch to Target CPA after learning)...');
  const campaignResult = await callMCP('create_campaign', {
    customer_id: CUSTOMER_ID,
    campaign_name: CONFIG.campaign.name,
    budget_resource_name: budgetResource,
    advertising_channel: 'SEARCH',
    start_paused: true
  });
  console.log(campaignResult);

  // Extract campaign ID
  const campaignMatch = campaignResult.match(/ID: (\d+)/);
  if (!campaignMatch) throw new Error('Failed to create campaign');
  const campaignId = campaignMatch[1];

  // Step 3: Set Location Targeting
  console.log('\n[3/7] Setting location targeting...');
  const locationResult = await callMCP('set_location_targeting', {
    customer_id: CUSTOMER_ID,
    campaign_id: campaignId,
    location_ids: CONFIG.locations.join(',')
  });
  console.log(locationResult);

  // Step 4: Add Negative Keywords
  console.log('\n[4/7] Adding negative keywords...');
  const negativeResult = await callMCP('add_negative_keywords', {
    customer_id: CUSTOMER_ID,
    campaign_id: campaignId,
    keywords: CONFIG.negativeKeywords.join(',')
  });
  console.log(negativeResult);

  // Step 5: Create Ad Groups
  console.log('\n[5/7] Creating ad groups...');
  const adGroupIds = [];

  for (const ag of CONFIG.adGroups) {
    console.log(`  Creating: ${ag.name}`);
    const agResult = await callMCP('create_ad_group', {
      customer_id: CUSTOMER_ID,
      campaign_id: campaignId,
      ad_group_name: ag.name,
      cpc_bid_micros: 1500000 // $1.50 default CPC
    });
    console.log(`    ${agResult}`);

    const agMatch = agResult.match(/ID: (\d+)/);
    if (agMatch) {
      adGroupIds.push({ id: agMatch[1], name: ag.name, keywords: ag.keywords });
    }
  }

  // Step 6: Add Keywords to Ad Groups
  console.log('\n[6/7] Adding keywords...');
  for (const ag of adGroupIds) {
    console.log(`  Adding keywords to: ${ag.name}`);
    const kwResult = await callMCP('add_keywords', {
      customer_id: CUSTOMER_ID,
      ad_group_id: ag.id,
      keywords: ag.keywords.join(','),
      match_type: 'PHRASE'
    });
    console.log(`    ${kwResult}`);
  }

  // Step 7: Create Ads
  console.log('\n[7/7] Creating responsive search ads...');
  for (const ag of adGroupIds) {
    console.log(`  Creating ad in: ${ag.name}`);
    const adResult = await callMCP('create_responsive_search_ad', {
      customer_id: CUSTOMER_ID,
      ad_group_id: ag.id,
      headlines: CONFIG.headlines.join('|'),
      descriptions: CONFIG.descriptions.join('|'),
      final_url: CONFIG.finalUrl,
      path1: 'create',
      path2: 'share'
    });
    console.log(`    ${adResult}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('CAMPAIGN CREATED SUCCESSFULLY');
  console.log('='.repeat(60));
  console.log(`Campaign ID: ${campaignId}`);
  console.log('Status: PAUSED (review before enabling)');
  console.log('\nTo enable: Run enable_campaign tool with this campaign ID');

  return campaignId;
}

async function main() {
  console.log('MyVibe Campaign Creator');
  console.log('=======================\n');

  const isReady = await checkAccountStatus();

  if (!isReady) {
    console.log('\n⏳ Account not ready. Run this script again when approved.');
    console.log('   Check status: node scripts/test-google-ads.mjs');
    process.exit(1);
  }

  try {
    const campaignId = await createCampaign();
    console.log(`\n✅ Done! Campaign ${campaignId} is ready for review.`);
  } catch (error) {
    console.error('\n❌ Error creating campaign:', error.message);
    process.exit(1);
  }
}

main();
