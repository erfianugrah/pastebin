/// <reference types="@cloudflare/workers-types" />

// Add or extend your main environment definition
export interface Env {
  // KV namespace bindings
  PASTES: KVNamespace;
  PASTE_LOGS: KVNamespace;
  PASTE_RL: KVNamespace;
  ANALYTICS: KVNamespace;
  WEBHOOKS: KVNamespace;
  ASSETS: Fetcher;
  
  // Environment variables
  NODE_ENV?: string;
  API_URL?: string;
  API_SECRET?: string;
  ADMIN_API_KEY?: string;
}

// Custom fetch response extending the Response interface
export interface ApiResponse<T = any> extends Response {
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

// Analytics event types
export type AnalyticsEventType = 
  | 'paste_created' 
  | 'paste_viewed' 
  | 'paste_deleted'
  | 'paste_expired'
  | 'paste_password_error'
  | 'rate_limit_exceeded';

// Analytics data structure
export interface AnalyticsEventData {
  id?: string; // Paste ID
  language?: string;
  visibility?: string;
  hasPassword?: boolean;
  isEncrypted?: boolean;
  ip?: string; // Will be hashed for privacy
  userAgent?: string;
  referrer?: string;
  [key: string]: any; // Allow additional properties
}

// Configuration types
export interface RateLimitConfig {
  maxRequests: number;
  windowSizeInSeconds: number;
  blockDurationInSeconds: number;
}

export interface ExpirationConfig {
  default: number; // in seconds
  options: {
    value: number;
    label: string;
  }[];
}

export interface LogStorageConfig {
  retentionDays: number;
  maxLogsPerLevel: number;
  levels: string[];
}

// Site configuration
export interface SiteConfig {
  name: string;
  url: string;
  description: string;
  maxPasteSize: number; // in bytes
  rateLimit: RateLimitConfig;
  expiration: ExpirationConfig;
  logStorage: LogStorageConfig;
  adminEmail: string;
  enableWebhooks: boolean;
}

// Admin dashboard types
export interface AdminStats {
  totalPastes: number;
  activePastes: number;
  viewsToday: number;
  viewsTotal: number;
  storageUsed: number; // in bytes
  popularLanguages: {
    language: string;
    count: number;
    percentage: number;
  }[];
  createVsViewRatio: number;
  retentionRate: number;
}

export interface AdminLogEntry {
  id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, any>;
}

export interface AdminLogQuery {
  level?: 'debug' | 'info' | 'warn' | 'error';
  limit?: number;
  startDate?: Date;
  endDate?: Date;
  search?: string;
}
