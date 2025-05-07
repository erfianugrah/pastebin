import { ConfigurationService } from '../config/config';
import { Logger } from './logger';
import { Env } from '../../types';

// Singleton instance of the logger
let loggerInstance: Logger | null = null;

/**
 * Initialize the logger with configuration and environment
 */
export function initializeLogger(configService: ConfigurationService, env?: Env): Logger {
  loggerInstance = new Logger(configService, env);
  return loggerInstance;
}

/**
 * Get the logger instance
 * If the logger hasn't been initialized, it will create one with default configuration
 */
export function getLogger(): Logger {
  if (!loggerInstance) {
    // Create a default logger if one hasn't been initialized
    const defaultConfigService = new ConfigurationService();
    loggerInstance = new Logger(defaultConfigService);
  }
  return loggerInstance;
}

// Export a default logger instance for convenience
export const logger = getLogger();