import { z } from 'zod';

export const ConfigSchema = z.object({
	application: z.object({
		name: z.string(),
		version: z.string(),
		baseUrl: z.url(),
	}),
	storage: z.object({
		namespace: z.string(),
		expirationStrategy: z.enum(['ttl', 'explicit', 'hybrid']).default('hybrid'),
	}),
	security: z.object({
		allowedOrigins: z.array(z.string()).optional(),
	}),
	paste: z.object({
		maxSize: z.number().default(25 * 1024 * 1024), // 25MiB (Cloudflare KV value limit)
		defaultExpiration: z.number().default(86400), // 1 day
		allowedLanguages: z.array(z.string()).optional(),
		maxRecentLimit: z.number().default(100),
	}),
	logging: z.object({
		level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
		pretty: z.boolean().default(false),
	}),
});

export type Config = z.infer<typeof ConfigSchema>;

export const defaultConfig: Config = {
	application: {
		name: 'pastebin',
		version: '1.0.0',
		baseUrl: 'https://pastebin.workers.dev',
	},
	storage: {
		namespace: 'PASTES',
		expirationStrategy: 'hybrid',
	},
	security: {
		allowedOrigins: ['*'],
	},
	paste: {
		maxSize: 25 * 1024 * 1024, // 25MiB (Cloudflare KV value limit)
		defaultExpiration: 86400, // 1 day
		allowedLanguages: undefined,
		maxRecentLimit: 100,
	},
	logging: {
		level: 'info',
		pretty: false,
	},
};

export class ConfigurationService {
	private config: Config;

	constructor(customConfig: Partial<Config> = {}) {
		// Merge default config with custom config
		const mergedConfig = this.mergeConfigs(defaultConfig, customConfig);

		// Validate config
		this.config = ConfigSchema.parse(mergedConfig);
	}

	private mergeConfigs(defaultCfg: Config, customCfg: Partial<Config>): Config {
		return {
			...defaultCfg,
			...customCfg,
			application: {
				...defaultCfg.application,
				...customCfg.application,
			},
			storage: {
				...defaultCfg.storage,
				...customCfg.storage,
			},
			security: {
				...defaultCfg.security,
				...customCfg.security,
			},
			paste: {
				...defaultCfg.paste,
				...customCfg.paste,
			},
			logging: {
				...defaultCfg.logging,
				...customCfg.logging,
			},
		};
	}

	getConfig(): Config {
		return this.config;
	}

	getApplicationConfig() {
		return this.config.application;
	}

	getStorageConfig() {
		return this.config.storage;
	}

	getSecurityConfig() {
		return this.config.security;
	}

	getPasteConfig() {
		return this.config.paste;
	}

	getLoggingConfig() {
		return this.config.logging;
	}
}
