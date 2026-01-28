/**
 * Task Loader - Discovers and loads tasks from tasks/ directory
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import logger from './logger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = join(__dirname, '..', '..', 'tasks');
const CONFIG_FILE = join(__dirname, '..', '..', 'config', 'tasks.yaml');

/**
 * Load task registry from config
 */
export function loadTaskRegistry() {
  try {
    const content = readFileSync(CONFIG_FILE, 'utf8');
    const config = parseYaml(content);
    return config.tasks || {};
  } catch (error) {
    logger.error('Failed to load task registry', { error: error.message });
    return {};
  }
}

/**
 * Discover available tasks from filesystem
 */
export function discoverTasks() {
  const tasks = [];

  try {
    const entries = readdirSync(TASKS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Skip template and hidden directories
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) {
        continue;
      }

      const taskDir = join(TASKS_DIR, entry.name);
      const taskYaml = join(taskDir, 'task.yaml');
      const runnerFile = join(taskDir, 'runner.mjs');

      // Check if task has required files
      if (!existsSync(taskYaml)) {
        logger.warn(`Task ${entry.name} missing task.yaml, skipping`);
        continue;
      }

      if (!existsSync(runnerFile)) {
        logger.warn(`Task ${entry.name} missing runner.mjs, skipping`);
        continue;
      }

      // Load task config
      try {
        const config = parseYaml(readFileSync(taskYaml, 'utf8'));
        tasks.push({
          name: entry.name,
          path: taskDir,
          config,
          runnerPath: runnerFile
        });
      } catch (e) {
        logger.error(`Failed to load task ${entry.name}`, { error: e.message });
      }
    }
  } catch (error) {
    logger.error('Failed to discover tasks', { error: error.message });
  }

  return tasks;
}

/**
 * Load a specific task's runner module
 */
export async function loadTaskRunner(taskName) {
  const runnerPath = join(TASKS_DIR, taskName, 'runner.mjs');

  if (!existsSync(runnerPath)) {
    throw new Error(`Task runner not found: ${runnerPath}`);
  }

  try {
    const module = await import(runnerPath);
    return module.default || module;
  } catch (error) {
    logger.error(`Failed to load task runner: ${taskName}`, { error: error.message });
    throw error;
  }
}

/**
 * Get merged task config (registry + task.yaml)
 */
export function getTaskConfig(taskName) {
  const registry = loadTaskRegistry();
  const registryConfig = registry[taskName] || {};

  const taskYaml = join(TASKS_DIR, taskName, 'task.yaml');
  let taskConfig = {};

  if (existsSync(taskYaml)) {
    try {
      taskConfig = parseYaml(readFileSync(taskYaml, 'utf8'));
    } catch (e) {
      logger.warn(`Failed to parse task.yaml for ${taskName}`);
    }
  }

  // Merge: registry config overrides task.yaml
  return {
    ...taskConfig,
    ...registryConfig,
    name: taskName
  };
}

/**
 * Get all enabled tasks
 */
export function getEnabledTasks() {
  const registry = loadTaskRegistry();
  const discovered = discoverTasks();

  const enabled = [];

  for (const task of discovered) {
    const registryEntry = registry[task.name];
    if (registryEntry?.enabled !== false) {
      enabled.push({
        ...task,
        config: { ...task.config, ...registryEntry }
      });
    }
  }

  return enabled;
}

export default {
  loadTaskRegistry,
  discoverTasks,
  loadTaskRunner,
  getTaskConfig,
  getEnabledTasks
};
