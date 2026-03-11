import pino from 'pino';
import { ConfigurationService } from '../config/config';

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

	constructor(configService: ConfigurationService) {
		const loggingConfig = configService.getLoggingConfig();

		this.logger = pino({
			level: loggingConfig.level,
			timestamp: () => `,"time":"${new Date().toISOString()}"`,
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
	}

	setContext(context: LoggerContext): void {
		this.context = { ...this.context, ...context };
	}

	clearContext(): void {
		this.context = {};
	}

	trace(msg: string, obj: object = {}): void {
		this.logger.trace({ ...this.context, ...obj }, msg);
	}

	debug(msg: string, obj: object = {}): void {
		this.logger.debug({ ...this.context, ...obj }, msg);
	}

	info(msg: string, obj: object = {}): void {
		this.logger.info({ ...this.context, ...obj }, msg);
	}

	warn(msg: string, obj: object = {}): void {
		this.logger.warn({ ...this.context, ...obj }, msg);
	}

	error(msg: string, obj: object = {}): void {
		this.logger.error({ ...this.context, ...obj }, msg);
	}

	fatal(msg: string, obj: object = {}): void {
		this.logger.fatal({ ...this.context, ...obj }, msg);
	}
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
	level: LogLevel;
	message: string;
	context: LoggerContext;
	timestamp: string;
}
