import { z } from 'zod';

export const ConfigSchema = z.object({
  application: z.object({
    name: z.string(),
    version: z.string(),
    baseUrl: z.url(),
  }),
  enableWebhooks: z.boolean().default(false),
  storage: z.object({
    namespace: z.string(),
    expirationStrategy: z.enum(['ttl', 'explicit', 'hybrid']).default('hybrid'),
  }),
  security: z.object({
    rateLimit: z.object({
      enabled: z.boolean().default(true),
      requestsPerMinute: z.number().default(60),
    }),
    allowedOrigins: z.array(z.string()).optional(),
  }),
  paste: z.object({
    maxSize: z.number().default(1024 * 1024), // 1MB
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
  enableWebhooks: false,
  storage: {
    namespace: 'PASTES',
    expirationStrategy: 'hybrid',
  },
  security: {
    rateLimit: {
      enabled: true,
      requestsPerMinute: 60,
    },
    allowedOrigins: ['*'],
  },
  paste: {
    maxSize: 1024 * 1024, // 1MB
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

  // Add get method to fix the property access error
  get(key: string): any {
    return (this.config as any)[key];
  }

  constructor(customConfig: Partial<Config> = {}) {
    // Merge default config with custom config
    const mergedConfig = this.mergeConfigs(defaultConfig, customConfig);
    
    // Validate config
    this.config = ConfigSchema.parse(mergedConfig);
  }

  private mergeConfigs(defaultConfig: Config, customConfig: Partial<Config>): Config {
    return {
      ...defaultConfig,
      ...customConfig,
      application: {
        ...defaultConfig.application,
        ...customConfig.application,
      },
      storage: {
        ...defaultConfig.storage,
        ...customConfig.storage,
      },
      security: {
        ...defaultConfig.security,
        ...customConfig.security,
        rateLimit: {
          ...defaultConfig.security.rateLimit,
          ...customConfig.security?.rateLimit,
        },
      },
      paste: {
        ...defaultConfig.paste,
        ...customConfig.paste,
      },
      logging: {
        ...defaultConfig.logging,
        ...customConfig.logging,
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
