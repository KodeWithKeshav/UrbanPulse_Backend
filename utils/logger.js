/**
 * Lightweight logging utility
 * Only logs in development mode to prevent performance issues
 */

const isDev = process.env.NODE_ENV !== 'production';

const logger = {
  info: (...args) => {
    if (isDev) console.log(...args);
  },
  error: (...args) => {
    // Always log errors
    console.error(...args);
  },
  warn: (...args) => {
    if (isDev) console.warn(...args);
  },
  debug: (...args) => {
    if (process.env.DEBUG === 'true') console.log(...args);
  }
};

module.exports = logger;
