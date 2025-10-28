import winston from 'winston';
import path from 'path';
import 'winston-daily-rotate-file';
import { config } from '../config/env';
import fs from 'fs';

const { combine, timestamp, printf, colorize } = winston.format;

// Create logs directory if it doesn't exist
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Define log format (currently unused but kept for future use)
// const logFormat = printf(({ level, message, timestamp, ...meta }) => {
//   return `${timestamp} [${level.toUpperCase()}]: ${message} ${
//     Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
//   }`;
// });

// Define different log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
winston.addColors({
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
});

// Create the logger
const logger = winston.createLogger({
  levels,
  level: config.nodeEnv === 'development' ? 'debug' : 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    // Console transport
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        printf(
          (info) => `${info.timestamp} [${info.level}]: ${info.message}`
        )
      ),
    }),
    // Daily rotate file transport for all logs
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      level: 'info',
    }),
    // Error logs in separate file
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error',
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(logDir, 'exceptions.log') }),
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: path.join(logDir, 'rejections.log') }),
  ],
});

// Create a stream for Morgan to use with Winston
const stream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};

export { logger, stream };
