/**
 * Client-side logging utilities
 * Provides consistent logging for browser environments with privacy controls
 */

// Log levels
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

// Log entry interface
interface LogEntry {
  timestamp?: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  stack?: string;
}

// Sensitive fields that should be redacted in logs
const SENSITIVE_FIELDS = [
  'password', 
  'key', 
  'token', 
  'secret', 
  'auth', 
  'authorization', 
  'encryptionKey',
  'privateKey',
  'salt'
];

/**
 * Sanitize an object by redacting sensitive information
 */
function sanitizeObject(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Check if this is a sensitive field
    const isSensitive = SENSITIVE_FIELDS.some(field => 
      key.toLowerCase().includes(field.toLowerCase())
    );

    if (isSensitive) {
      // Redact sensitive fields
      result[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively sanitize nested objects
      result[key] = sanitizeObject(value);
    } else {
      // Keep non-sensitive values as is
      result[key] = value;
    }
  }

  return result;
}

/**
 * Format log entry to string
 */
function formatLogEntry(entry: LogEntry): string {
  const timestamp = entry.timestamp || new Date().toISOString();
  let message = `[${timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`;

  if (entry.context) {
    const sanitizedContext = sanitizeObject(entry.context);
    message += ` ${JSON.stringify(sanitizedContext)}`;
  }

  if (entry.stack && entry.level === LogLevel.ERROR) {
    message += `\n${entry.stack}`;
  }

  return message;
}

/**
 * Logger class with methods for different log levels
 */
class ClientLogger {
  private minLevel: LogLevel;
  private enableConsole: boolean;
  private customHandlers: Array<(entry: LogEntry) => void> = [];
  // In-memory log buffer for client-side logging
  private logBuffer: LogEntry[] = [];
  private maxBufferSize: number = 100;

  constructor() {
    // Set default log level based on environment
    this.minLevel = 
      process.env.NODE_ENV === 'production' 
        ? LogLevel.INFO 
        : LogLevel.DEBUG;
    
    // Enable console logging by default
    this.enableConsole = true;
  }

  /**
   * Configure the logger
   */
  configure(options: { 
    minLevel?: LogLevel, 
    enableConsole?: boolean,
    maxBufferSize?: number,
    addHandler?: (entry: LogEntry) => void
  }) {
    if (options.minLevel !== undefined) {
      this.minLevel = options.minLevel;
    }
    
    if (options.enableConsole !== undefined) {
      this.enableConsole = options.enableConsole;
    }
    
    if (options.maxBufferSize !== undefined) {
      this.maxBufferSize = options.maxBufferSize;
    }
    
    if (options.addHandler) {
      this.customHandlers.push(options.addHandler);
    }
  }

  /**
   * Add a custom log handler
   */
  addHandler(handler: (entry: LogEntry) => void) {
    this.customHandlers.push(handler);
  }

  /**
   * Get all logs from the buffer
   */
  getLogs(): LogEntry[] {
    return [...this.logBuffer];
  }

  /**
   * Clear the log buffer
   */
  clearLogs(): void {
    this.logBuffer = [];
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, messageOrObject: string | Record<string, any>, context?: Record<string, any>) {
    // Skip if below minimum level
    if (this.shouldSkip(level)) return;

    let message: string;
    let logContext = context || {};

    // Handle when first argument is an object
    if (typeof messageOrObject === 'object') {
      message = messageOrObject.message || 'No message provided';
      logContext = { ...messageOrObject, ...logContext };
      // Remove message from context since it's used as the main message
      delete logContext.message;
    } else {
      message = messageOrObject;
    }

    // Create log entry
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: Object.keys(logContext).length > 0 ? logContext : undefined,
      stack: logContext.stack,
    };

    // Add to buffer, removing oldest entries if buffer is full
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }

    // Format and send to console if enabled
    if (this.enableConsole) {
      const formattedEntry = formatLogEntry(entry);
      
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(formattedEntry);
          break;
        case LogLevel.INFO:
          console.info(formattedEntry);
          break;
        case LogLevel.WARN:
          console.warn(formattedEntry);
          break;
        case LogLevel.ERROR:
          console.error(formattedEntry);
          break;
      }
    }

    // Send to custom handlers
    for (const handler of this.customHandlers) {
      try {
        handler(entry);
      } catch (err) {
        if (this.enableConsole) {
          console.error(`Error in custom log handler: ${err}`);
        }
      }
    }
  }

  /**
   * Check if log level should be skipped
   */
  private shouldSkip(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const minLevelIndex = levels.indexOf(this.minLevel);
    const currentLevelIndex = levels.indexOf(level);
    
    return currentLevelIndex < minLevelIndex;
  }

  /**
   * Log debug message
   */
  debug(messageOrObject: string | Record<string, any>, context?: Record<string, any>) {
    this.log(LogLevel.DEBUG, messageOrObject, context);
  }

  /**
   * Log info message
   */
  info(messageOrObject: string | Record<string, any>, context?: Record<string, any>) {
    this.log(LogLevel.INFO, messageOrObject, context);
  }

  /**
   * Log warning message
   */
  warn(messageOrObject: string | Record<string, any>, context?: Record<string, any>) {
    this.log(LogLevel.WARN, messageOrObject, context);
  }

  /**
   * Log error message
   */
  error(messageOrObject: string | Record<string, any>, context?: Record<string, any>) {
    this.log(LogLevel.ERROR, messageOrObject, context);
  }
}

// Export a singleton instance
export const clientLogger = new ClientLogger();