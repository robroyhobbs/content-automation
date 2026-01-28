/**
 * Shared Logger for Content Automation Hub
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, '..', '..', 'logs');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, task, ...meta }) => {
          const taskPrefix = task ? `[${task}] ` : '';
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} ${level}: ${taskPrefix}${message}${metaStr}`;
        })
      )
    }),
    // Daily rotating file
    new DailyRotateFile({
      dirname: LOGS_DIR,
      filename: 'hub-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d'
    })
  ]
});

// Create task-specific logger
export function createTaskLogger(taskName) {
  return {
    info: (msg, meta = {}) => logger.info(msg, { task: taskName, ...meta }),
    warn: (msg, meta = {}) => logger.warn(msg, { task: taskName, ...meta }),
    error: (msg, meta = {}) => logger.error(msg, { task: taskName, ...meta }),
    debug: (msg, meta = {}) => logger.debug(msg, { task: taskName, ...meta })
  };
}

export default logger;
