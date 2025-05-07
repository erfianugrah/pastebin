/**
 * Client-side logger for frontend components
 * Provides consistent logging across the frontend application
 */
import { ErrorCategory } from './errorTypes';

// Log level type
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Client log entry interface
export interface ClientLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  category?: ErrorCategory;
  stack?: string;
  componentStack?: string;
  [key: string]: any;
}

// Client logger options
interface ClientLoggerOptions {
  level: LogLevel;
  console: boolean;
  storeLocally: boolean;
  localStorageKey: string;
  maxLogEntries: number;
  reportToServer: boolean;
  serverLogEndpoint?: string;
}

// Default logger options
const defaultOptions: ClientLoggerOptions = {
  level: 'info',
  console: true,
  storeLocally: true,
  localStorageKey: 'pastebin_client_logs',
  maxLogEntries: 100,
  reportToServer: false,
};

/**
 * Client-side logger class
 */
class ClientLogger {
  private options: ClientLoggerOptions;
  private logs: ClientLogEntry[] = [];

  constructor(options: Partial<ClientLoggerOptions> = {}) {
    this.options = { ...defaultOptions, ...options };
    this.loadLogsFromStorage();
  }

  /**
   * Load logs from localStorage if available
   */
  private loadLogsFromStorage(): void {
    if (this.options.storeLocally && typeof window !== 'undefined' && window.localStorage) {
      try {
        const storedLogs = localStorage.getItem(this.options.localStorageKey);
        if (storedLogs) {
          this.logs = JSON.parse(storedLogs);
        }
      } catch (error) {
        console.error('Failed to load logs from localStorage:', error);
      }
    }
  }

  /**
   * Save logs to localStorage
   */
  private saveLogsToStorage(): void {
    if (this.options.storeLocally && typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem(
          this.options.localStorageKey,
          JSON.stringify(this.logs.slice(-this.options.maxLogEntries))
        );
      } catch (error) {
        console.error('Failed to save logs to localStorage:', error);
      }
    }
  }

  /**
   * Create a log entry
   */
  private log(level: LogLevel, messageOrData: string | Record<string, any>, additionalData: Record<string, any> = {}): void {
    // Skip if log level is not sufficient
    if (!this.shouldLog(level)) return;

    let message: string;
    let data: Record<string, any> = {};

    if (typeof messageOrData === 'string') {
      message = messageOrData;
      data = additionalData;
    } else {
      message = messageOrData.message || 'No message provided';
      data = messageOrData;
    }

    // Create log entry
    const logEntry: ClientLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data,
    };

    // Add to logs array
    this.logs.push(logEntry);
    
    // Trim logs if they exceed max entries
    if (this.logs.length > this.options.maxLogEntries) {
      this.logs = this.logs.slice(-this.options.maxLogEntries);
    }

    // Log to console if enabled
    if (this.options.console) {
      this.logToConsole(level, message, data);
    }

    // Save to localStorage if enabled
    if (this.options.storeLocally) {
      this.saveLogsToStorage();
    }

    // Report to server if enabled
    if (this.options.reportToServer && level === 'error') {
      this.reportToServer(logEntry);
    }
  }

  /**
   * Check if the log level should be recorded
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };

    return levels[level] >= levels[this.options.level];
  }

  /**
   * Log to browser console
   */
  private logToConsole(level: LogLevel, message: string, data: Record<string, any>): void {
    switch (level) {
      case 'debug':
        console.debug(`[DEBUG] ${message}`, data);
        break;
      case 'info':
        console.info(`[INFO] ${message}`, data);
        break;
      case 'warn':
        console.warn(`[WARN] ${message}`, data);
        break;
      case 'error':
        console.error(`[ERROR] ${message}`, data);
        break;
    }
  }

  /**
   * Report error logs to server endpoint
   */
  private reportToServer(logEntry: ClientLogEntry): void {
    if (!this.options.serverLogEndpoint) return;

    // Don't block with await
    fetch(this.options.serverLogEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(logEntry),
    }).catch(error => {
      // Don't log this error to avoid recursion
      console.error('Failed to report error to server:', error);
    });
  }

  /**
   * Public logging methods
   */
  debug(messageOrData: string | Record<string, any>, additionalData: Record<string, any> = {}): void {
    this.log('debug', messageOrData, additionalData);
  }

  info(messageOrData: string | Record<string, any>, additionalData: Record<string, any> = {}): void {
    this.log('info', messageOrData, additionalData);
  }

  warn(messageOrData: string | Record<string, any>, additionalData: Record<string, any> = {}): void {
    this.log('warn', messageOrData, additionalData);
  }

  error(messageOrData: string | Record<string, any>, additionalData: Record<string, any> = {}): void {
    this.log('error', messageOrData, additionalData);
  }

  /**
   * Get all log entries
   */
  getLogs(): ClientLogEntry[] {
    return [...this.logs];
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
    if (this.options.storeLocally && typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(this.options.localStorageKey);
    }
  }

  /**
   * Update logger options
   */
  updateOptions(newOptions: Partial<ClientLoggerOptions>): void {
    this.options = { ...this.options, ...newOptions };
  }
}

// Create and export a singleton instance
export const clientLogger = new ClientLogger();