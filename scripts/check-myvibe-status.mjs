#!/usr/bin/env node
/**
 * Check MyVibe Account Status
 * Run: node scripts/check-myvibe-status.mjs
 */

import { spawn } from 'node:child_process';

const MCP_PATH = '/Users/robroyhobbs/work/google-ads-automation/mcp-server';
const PYTHON_PATH = `${MCP_PATH}/.venv/bin/python3`;

async function checkStatus() {
  console.log('Checking MyVibe Google Ads Account Status...\n');

  const code = `
import asyncio
import sys
sys.path.insert(0, '${MCP_PATH}')
from dotenv import load_dotenv
import os
os.chdir('${MCP_PATH}')
load_dotenv()
from google_ads_server import get_account_currency

async def main():
    try:
        result = await get_account_currency(customer_id='1749226866')
        if 'Error' in result or 'NOT_ENABLED' in result:
            print('STATUS: NOT_READY')
            print('The account is still pending approval or setup.')
        else:
            print('STATUS: READY')
            print(result)
            print('')
            print('Run: node scripts/create-myvibe-campaign.mjs')
    except Exception as e:
        print('STATUS: NOT_READY')
        print(f'Error: {str(e)[:200]}')

asyncio.run(main())
`;

  const child = spawn(PYTHON_PATH, ['-c', code], {
    cwd: MCP_PATH,
    env: { ...process.env, PYTHONPATH: MCP_PATH }
  });

  child.stdout.on('data', d => process.stdout.write(d));
  child.stderr.on('data', d => {
    const text = d.toString();
    if (!text.includes('INFO -')) process.stderr.write(d);
  });
}

checkStatus();
