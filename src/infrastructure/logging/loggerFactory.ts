import { ConfigurationService } from '../config/config';
import { Logger } from './logger';

// Singleton instance of the logger
let loggerInstance: Logger | null = null;

/**
 * Initialize the logger with configuration
 */
export function initializeLogger(configService: ConfigurationService): Logger {
	loggerInstance = new Logger(configService);
	return loggerInstance;
}

/**
 * Get the logger instance
 * If the logger hasn't been initialized, it will create one with default configuration
 */
export function getLogger(): Logger {
	if (!loggerInstance) {
		const defaultConfigService = new ConfigurationService();
		loggerInstance = new Logger(defaultConfigService);
	}
	return loggerInstance;
}

// Export a default logger instance for convenience
export const logger = getLogger();
