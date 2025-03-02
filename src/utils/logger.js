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
  ERROR: 3,
  CRITICAL: 4
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
   * Log a critical error message (always shown)
   * @param {String} message - The message to log
   */
  critical(message) {
    if (currentLogLevel <= LOG_LEVELS.CRITICAL) {
      this.writeLog('CRITICAL', message);
    }
  },
  
  /**
   * Log a payment error with special formatting for better visibility
   * @param {String} message - The message to log
   */
  paymentError(message) {
    if (currentLogLevel <= LOG_LEVELS.ERROR) {
      const formattedMessage = `\n======= PAYMENT ISSUE DETECTED =======\n${message}\nPlease check Black Forest AI account status and billing.\n=======================================`;
      this.writeLog('PAYMENT_ERROR', formattedMessage);
    }
  },
  
  /**
   * Log an API error with detail
   * @param {String} endpoint - The API endpoint
   * @param {Object|Error} error - The error object or message
   * @param {Object} requestData - The request data that caused the error
   */
  apiError(endpoint, error, requestData = null) {
    if (currentLogLevel <= LOG_LEVELS.ERROR) {
      let formattedMessage = `API Error on ${endpoint}:`;
      
      // Extract error details
      if (error instanceof Error) {
        formattedMessage += `\n- Message: ${error.message}`;
        
        if (error.response) {
          formattedMessage += `\n- Status: ${error.response.status}`;
          
          if (error.response.data) {
            formattedMessage += `\n- Response: ${JSON.stringify(error.response.data)}`;
          }
        }
        
        if (error.stack) {
          formattedMessage += `\n- Stack: ${error.stack}`;
        }
      } else {
        formattedMessage += `\n- ${JSON.stringify(error)}`;
      }
      
      // Include request data if provided
      if (requestData) {
        formattedMessage += `\n- Request Data: ${JSON.stringify(requestData)}`;
      }
      
      this.writeLog('API_ERROR', formattedMessage);
      
      // Check for payment issues
      const errorMessage = error.message || '';
      const errorResponseData = error.response?.data ? JSON.stringify(error.response.data) : '';
      
      if (
        error.response?.status === 402 ||
        errorMessage.includes('402') ||
        errorMessage.toLowerCase().includes('payment') ||
        errorResponseData.includes('402') ||
        errorResponseData.toLowerCase().includes('payment')
      ) {
        this.paymentError(`Payment required error detected in API call to ${endpoint}`);
      }
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
    
    // Log to console with coloring
    const consoleColors = {
      DEBUG: '\x1b[34m', // Blue
      INFO: '\x1b[32m',  // Green
      WARN: '\x1b[33m',  // Yellow
      ERROR: '\x1b[31m', // Red
      CRITICAL: '\x1b[41m\x1b[37m', // White on Red Background
      PAYMENT_ERROR: '\x1b[41m\x1b[37m', // White on Red Background
      API_ERROR: '\x1b[35m', // Magenta
      RESET: '\x1b[0m'  // Reset
    };
    
    const color = consoleColors[level] || consoleColors.RESET;
    const consoleMethod = 
      level === 'ERROR' || level === 'CRITICAL' || level === 'PAYMENT_ERROR' ? 'error' : 
      level === 'WARN' ? 'warn' : 'log';
    
    console[consoleMethod](`${color}[${level}]${consoleColors.RESET} ${message}`);
    
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