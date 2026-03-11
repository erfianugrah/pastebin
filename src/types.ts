/// <reference types="@cloudflare/workers-types" />

export interface Env {
	PASTES: KVNamespace;
	ASSETS: Fetcher;

	// Environment variables
	NODE_ENV?: string;
	API_URL?: string;
	API_SECRET?: string;
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

// Configuration types
export interface ExpirationConfig {
	default: number; // in seconds
	options: {
		value: number;
		label: string;
	}[];
}
