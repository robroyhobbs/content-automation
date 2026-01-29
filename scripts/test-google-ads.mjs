#!/usr/bin/env node
/**
 * Google Ads MCP Integration Test
 *
 * Tests the connection to the Google Ads MCP server.
 * Run: node scripts/test-google-ads.mjs
 */

import { spawn } from 'node:child_process';

const MCP_PATH = '/Users/robroyhobbs/work/google-ads-automation/mcp-server';
const PYTHON_PATH = `${MCP_PATH}/.venv/bin/python3`;

async function testMCPConnection() {
  console.log('='.repeat(60));
  console.log('Google Ads MCP Server Test');
  console.log('='.repeat(60));

  // Test 1: Check Python venv exists
  console.log('\n[Test 1] Checking Python virtual environment...');
  try {
    const result = await runCommand(PYTHON_PATH, ['--version']);
    console.log(`  ✅ Python found: ${result.trim()}`);
  } catch (error) {
    console.log(`  ❌ Python not found: ${error.message}`);
    console.log('  Run: cd /Users/robroyhobbs/work/google-ads-automation/mcp-server && python3 -m venv .venv');
    return;
  }

  // Test 2: Check MCP server imports
  console.log('\n[Test 2] Testing MCP server imports...');
  try {
    const testCode = `
import sys
sys.path.insert(0, '${MCP_PATH}')
try:
    from google_ads_server import list_accounts, get_campaign_performance
    print("OK")
except Exception as e:
    print(f"ERROR: {e}")
`;
    const result = await runPython(testCode);
    if (result.trim() === 'OK') {
      console.log('  ✅ MCP server imports successful');
    } else {
      console.log(`  ❌ Import failed: ${result}`);
    }
  } catch (error) {
    console.log(`  ❌ Import test failed: ${error.message}`);
  }

  // Test 3: Check environment variables
  console.log('\n[Test 3] Checking environment variables...');
  const requiredVars = [
    'GOOGLE_ADS_CUSTOMER_ID',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_CREDENTIALS_PATH'
  ];

  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (value) {
      const masked = varName.includes('TOKEN') ? '***' : value.substring(0, 10) + '...';
      console.log(`  ✅ ${varName}: ${masked}`);
    } else {
      console.log(`  ⚠️  ${varName}: Not set (will use MCP server .env)`);
    }
  }

  // Test 4: Test API call (list_accounts)
  console.log('\n[Test 4] Testing Google Ads API connection...');
  try {
    const testCode = `
import asyncio
import sys
sys.path.insert(0, '${MCP_PATH}')
from dotenv import load_dotenv
import os
os.chdir('${MCP_PATH}')
load_dotenv()

from google_ads_server import list_accounts

async def main():
    result = await list_accounts()
    print(result)

asyncio.run(main())
`;
    const result = await runPython(testCode);
    if (result.includes('Error') || result.includes('PERMISSION_DENIED')) {
      console.log(`  ⚠️  API returned: ${result.substring(0, 100)}...`);
      console.log('  Note: Dev token may need Standard access approval');
    } else if (result.includes('Account ID')) {
      console.log('  ✅ API connection successful!');
      console.log(result.split('\n').slice(0, 5).join('\n'));
    } else {
      console.log(`  ℹ️  API response: ${result.substring(0, 200)}`);
    }
  } catch (error) {
    console.log(`  ❌ API test failed: ${error.message}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test complete');
  console.log('='.repeat(60));
}

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => stdout += d);
    child.stderr.on('data', (d) => stderr += d);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Exit code ${code}`));
    });
    child.on('error', reject);
  });
}

function runPython(code) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_PATH, ['-c', code], {
      cwd: MCP_PATH,
      env: { ...process.env, PYTHONPATH: MCP_PATH }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => stdout += d);
    child.stderr.on('data', (d) => stderr += d);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `Exit code ${code}`));
    });
    child.on('error', reject);
  });
}

testMCPConnection().catch(console.error);
