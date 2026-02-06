import pino from 'pino';
import { ConfigurationService } from '../config/config';
import { Env } from '../../types';

export interface LoggerContext {
  requestId?: string;
  pasteId?: string;
  url?: string;
  method?: string;
  cf?: any;
  [key: string]: unknown;
}

export class Logger {
  private logger: pino.Logger;
  private context: LoggerContext = {};
  private env?: Env;
  private logsKV?: KVNamespace;

  constructor(configService: ConfigurationService, env?: Env) {
    const loggingConfig = configService.getLoggingConfig();
    this.env = env;
    
    // Store the specific LOGS KV namespace if available
    this.logsKV = env?.PASTE_LOGS;
    
    // Configure Pino with Cloudflare-friendly options
    this.logger = pino({
      level: loggingConfig.level,
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      // Cloudflare Workers don't support process.stdout, so we use a custom destination
      base: {
        env: configService.getConfig().application.name,
        version: configService.getConfig().application.version,
      },
      transport: loggingConfig.pretty
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
            },
          }
        : undefined,
    });
    
    // Log warning if the LOGS KV namespace is not available
    if (!this.logsKV) {
      console.warn("PASTE_LOGS KV namespace not configured. Logs will not be persisted to KV.");
      this.logger.warn({}, "PASTE_LOGS KV namespace not configured. Logs will not be persisted to KV.");
    }
  }

  setContext(context: LoggerContext): void {
    this.context = { ...this.context, ...context };
  }

  clearContext(): void {
    this.context = {};
  }

  trace(msg: string, obj: object = {}): void {
    this.log('trace', msg, obj);
  }

  debug(msg: string, obj: object = {}): void {
    this.log('debug', msg, obj);
  }

  info(msg: string, obj: object = {}): void {
    this.log('info', msg, obj);
  }

  warn(msg: string, obj: object = {}): void {
    this.log('warn', msg, obj);
  }

  error(msg: string, obj: object = {}): void {
    this.log('error', msg, obj);
  }

  fatal(msg: string, obj: object = {}): void {
    this.log('fatal', msg, obj);
  }
  
  /**
   * Core logging method that handles both console output and potential storage
   */
  private log(level: LogLevel, msg: string, obj: object = {}): void {
    // Log to console using Pino
    this.logger[level]({ ...this.context, ...obj }, msg);
    
    // Store logs in dedicated LOGS KV namespace
    if (this.logsKV) {
      try {
        const logEntry = {
          level,
          message: msg,
          context: { ...this.context, ...obj },
          timestamp: new Date().toISOString()
        };
        
        // Store in KV with auto-expiration (7 days)
        const key = `logs:${level}:${Date.now()}:${crypto.randomUUID()}`;
        this.logsKV.put(key, JSON.stringify(logEntry), { 
          expirationTtl: 60 * 60 * 24 * 7 // 7 days
        }).catch(e => console.error(`Failed to persist log to PASTE_LOGS KV (key: ${key}):`, e));
      } catch (e) {
        // Don't let logging errors cause issues
        console.error('Failed to persist log:', e);
      }
    }
  }

  /**
   * Retrieve logs from KV storage
   * @param options Query options
   * @returns Array of log entries
   */
  async getLogs(options: LogQueryOptions = {}): Promise<LogEntry[]> {
    if (!this.logsKV) {
      this.warn('PASTE_LOGS KV namespace not configured, cannot retrieve stored logs.');
      return [];
    }

    const {
      level,
      limit = 100,
      startDate,
      endDate = new Date(),
    } = options;

    // Convert dates to timestamps
    const endTimestamp = endDate.getTime();
    const startTimestamp = startDate ? startDate.getTime() : endTimestamp - (24 * 60 * 60 * 1000); // Default to last 24h

    try {
      // Construct the prefix for querying logs
      const prefix = level ? `logs:${level}:` : 'logs:';
      
      // List all logs with the given prefix
      const { keys } = await this.logsKV.list({ prefix });
      
      // Filter keys by timestamp
      const filteredKeys = keys.filter(key => {
        // Extract timestamp from key (format: logs:level:timestamp:uuid)
        const keyParts = key.name.split(':');
        if (keyParts.length < 3) return false;
        
        const timestamp = parseInt(keyParts[2], 10);
        return timestamp >= startTimestamp && timestamp <= endTimestamp;
      });
      
      // Sort keys by timestamp (newest first) and apply limit
      const sortedKeys = filteredKeys
        .sort((a, b) => {
          const aTimestamp = parseInt(a.name.split(':')[2], 10);
          const bTimestamp = parseInt(b.name.split(':')[2], 10);
          return bTimestamp - aTimestamp;
        })
        .slice(0, limit);
      
      // Retrieve log entries in bulk (up to 100 keys per request)
      const logEntries: LogEntry[] = [];
      const chunkSize = 100;

      for (let i = 0; i < sortedKeys.length; i += chunkSize) {
        const chunk = sortedKeys.slice(i, i + chunkSize).map(key => key.name);
        const values = await this.logsKV.get(chunk);

        for (const [keyName, logJson] of values.entries()) {
          if (!logJson) {
            continue;
          }

          try {
            const entry = JSON.parse(logJson) as LogEntry;
            logEntries.push(entry);
          } catch (e) {
            // Skip invalid entries
            this.error('Failed to parse log entry from KV', { key: keyName, error: e });
          }
        }
      }
      
      return logEntries;
    } catch (e) {
      this.error('Failed to retrieve logs from PASTE_LOGS KV', { error: e });
      return [];
    }
  }
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  level: LogLevel;
  message: string;
  context: LoggerContext;
  timestamp: string;
}

export interface LogQueryOptions {
  level?: LogLevel;
  limit?: number;
  startDate?: Date;
  endDate?: Date;
}
