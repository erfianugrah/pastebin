import { Logger } from './logger';

let loggerInstance: Logger | null = null;

export function initializeLogger(): Logger {
	loggerInstance = new Logger();
	return loggerInstance;
}

export function getLogger(): Logger {
	if (!loggerInstance) {
		loggerInstance = new Logger();
	}
	return loggerInstance;
}
