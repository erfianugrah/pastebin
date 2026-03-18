import { Logger } from './logger';

/**
 * Create a fresh Logger instance.
 *
 * Each request should get its own logger so that context (requestId, path,
 * etc.) never leaks between concurrent requests sharing the same isolate.
 */
export function createLogger(): Logger {
	return new Logger();
}

/** @deprecated Use createLogger() instead. Kept for backward compatibility. */
export const initializeLogger = createLogger;
