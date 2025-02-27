/**
 * Logger Utility
 * Provides a consistent logging interface for the application
 */

const fs = require('fs-extra');
const path = require('path');

// Ensure log directory exists
const logDir = path.join(__dirname, '../../logs');
fs.ensureDirSync(logDir);

// Get timestamp in format YYYY-MM-DD HH:MM:SS
const getTimestamp = () => {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19);
};

// Log levels
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// Current log level (can be set via environment variable)
const currentLogLevel = LOG_LEVELS[process.env.LOG_LEVEL] || LOG_LEVELS.INFO;

// Logger implementation
const logger = {
  /**
   * Log a debug message
   * @param {String} message - The message to log
   */
  debug(message) {
    if (currentLogLevel <= LOG_LEVELS.DEBUG) {
      this.writeLog('DEBUG', message);
    }
  },
  
  /**
   * Log an info message
   * @param {String} message - The message to log
   */
  info(message) {
    if (currentLogLevel <= LOG_LEVELS.INFO) {
      this.writeLog('INFO', message);
    }
  },
  
  /**
   * Log a warning message
   * @param {String} message - The message to log
   */
  warn(message) {
    if (currentLogLevel <= LOG_LEVELS.WARN) {
      this.writeLog('WARN', message);
    }
  },
  
  /**
   * Log an error message
   * @param {String} message - The message to log
   */
  error(message) {
    if (currentLogLevel <= LOG_LEVELS.ERROR) {
      this.writeLog('ERROR', message);
    }
  },
  
  /**
   * Write a log entry
   * @param {String} level - The log level
   * @param {String} message - The message to log
   */
  writeLog(level, message) {
    const timestamp = getTimestamp();
    const logEntry = `[${timestamp}] [${level}] ${message}\n`;
    
    // Log to console
    const consoleMethod = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log';
    console[consoleMethod](`[${level}] ${message}`);
    
    // Log to file
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(logDir, `${today}.log`);
    
    try {
      fs.appendFileSync(logFile, logEntry);
    } catch (error) {
      console.error(`Failed to write to log file: ${error.message}`);
    }
  }
};

module.exports = { logger }; 