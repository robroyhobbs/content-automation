/**
 * DocSmith Task Runner
 *
 * Wraps the existing docsmith-daily automation project.
 * This runner delegates to the docsmith-daily project for actual execution.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Run the docsmith automation
 */
async function run(context) {
  const { config, logger } = context;
  const projectPath = config.settings?.projectPath || join(process.env.HOME, 'docsmith-automation');

  logger.info('Starting DocSmith automation', { projectPath });

  // Verify project exists
  if (!existsSync(projectPath)) {
    return {
      success: false,
      error: `DocSmith project not found at ${projectPath}`
    };
  }

  // Run the docsmith-daily automation
  return new Promise((resolve) => {
    const startTime = Date.now();

    const child = spawn('node', ['src/index.mjs'], {
      cwd: projectPath,
      env: {
        ...process.env,
        NODE_ENV: 'production'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let publishedUrl = null;

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;

      // Parse JSON log lines for progress
      for (const line of text.split('\n')) {
        try {
          const entry = JSON.parse(line);
          if (entry.message) {
            logger.info(entry.message);
          }
          // Check for published URL
          if (entry.publishedUrl) {
            publishedUrl = entry.publishedUrl;
          }
        } catch {
          // Not JSON, ignore
        }
      }

      // Also check raw output for URL
      const urlMatch = text.match(/https:\/\/docsmith\.aigne\.io\/[^\s\n\)"]+/);
      if (urlMatch) {
        publishedUrl = urlMatch[0];
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Timeout after configured minutes
    const timeout = setTimeout(() => {
      logger.error('DocSmith timeout reached, killing process');
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, (config.timeoutMinutes || 45) * 60 * 1000);

    child.on('close', (code) => {
      clearTimeout(timeout);

      const duration = Date.now() - startTime;

      if (code === 0 || publishedUrl) {
        logger.info('DocSmith completed successfully', { publishedUrl, duration });
        resolve({
          success: true,
          url: publishedUrl,
          output: `Processed repositories, published to ${publishedUrl || 'DocSmith Cloud'}`,
          metadata: { duration }
        });
      } else {
        logger.error('DocSmith failed', { code, stderr: stderr.slice(-500) });
        resolve({
          success: false,
          error: `Process exited with code ${code}`,
          output: stderr.slice(-1000)
        });
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      logger.error('DocSmith spawn error', { error: error.message });
      resolve({
        success: false,
        error: error.message
      });
    });
  });
}

/**
 * Get task status
 */
async function getStatus(context) {
  const { config } = context;
  const projectPath = config.settings?.projectPath || join(process.env.HOME, 'docsmith-automation');
  const stateFile = join(projectPath, 'data', 'state.json');

  try {
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      return {
        healthy: true,
        todayProcessed: state.todayProcessed || 0,
        totalProcessed: state.statistics?.totalProcessed || 0,
        lastSuccess: state.statistics?.successCount || 0
      };
    }
  } catch {
    // Ignore
  }

  return { healthy: true, todayProcessed: 0 };
}

export default { run, getStatus };
