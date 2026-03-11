/**
 * Structured logger for Cloudflare Workers.
 *
 * Uses console.log / console.warn / console.error with JSON objects so that
 * Workers Logs automatically indexes every field for filtering & querying.
 * See: https://developers.cloudflare.com/workers/observability/logs/workers-logs/
 */

export interface LoggerContext {
	requestId?: string;
	pasteId?: string;
	url?: string;
	method?: string;
	path?: string;
	cf?: Record<string, unknown>;
	[key: string]: unknown;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
	private context: LoggerContext = {};

	setContext(context: LoggerContext): void {
		this.context = { ...this.context, ...context };
	}

	clearContext(): void {
		this.context = {};
	}

	debug(msg: string, data: Record<string, unknown> = {}): void {
		console.log({ level: 'debug', msg, ...this.context, ...data });
	}

	info(msg: string, data: Record<string, unknown> = {}): void {
		console.log({ level: 'info', msg, ...this.context, ...data });
	}

	warn(msg: string, data: Record<string, unknown> = {}): void {
		console.warn({ level: 'warn', msg, ...this.context, ...data });
	}

	error(msg: string, data: Record<string, unknown> = {}): void {
		console.error({ level: 'error', msg, ...this.context, ...data });
	}
}
