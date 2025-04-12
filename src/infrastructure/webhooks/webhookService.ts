// Use the global crypto object from Cloudflare Workers runtime
import { AppError } from '../errors/AppError';
import { Logger } from '../logging/logger';
import { Paste } from '../../domain/models/paste';

// Webhook event types
export type WebhookEventType = 
  | 'paste.created' 
  | 'paste.viewed' 
  | 'paste.deleted' 
  | 'paste.expired';

// Webhook endpoint configuration
export interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  description?: string;
  createdAt: Date;
  isActive: boolean;
}

// Webhook event payload
export interface WebhookPayload {
  id: string;
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, any>;
}

export class WebhookService {
  private endpoints: WebhookEndpoint[] = [];
  private kvNamespace: KVNamespace;

  constructor(
    private readonly logger: Logger,
    kvNamespace: KVNamespace
  ) {
    this.kvNamespace = kvNamespace;
  }

  // Initialize the service by loading endpoints from KV
  public async init(): Promise<void> {
    try {
      const storedEndpoints = await this.kvNamespace.get('webhook_endpoints');
      if (storedEndpoints) {
        this.endpoints = JSON.parse(storedEndpoints);
        this.logger.debug('Loaded webhook endpoints', { count: this.endpoints.length });
      }
    } catch (error) {
      this.logger.error('Failed to initialize webhook service', { error });
      throw new AppError('Failed to initialize webhook service', '500');
    }
  }

  // Register a new webhook endpoint
  public async registerEndpoint(endpoint: Omit<WebhookEndpoint, 'id' | 'createdAt'>): Promise<WebhookEndpoint> {
    try {
      // Generate a unique ID for the endpoint
      const id = crypto.randomUUID();
      
      // Create the new endpoint
      const newEndpoint: WebhookEndpoint = {
        ...endpoint,
        id,
        createdAt: new Date(),
        isActive: true,
      };
      
      // Add to the in-memory list
      this.endpoints.push(newEndpoint);
      
      // Persist to KV
      await this.persistEndpoints();
      
      this.logger.info('Registered new webhook endpoint', { 
        id, 
        url: endpoint.url,
        events: endpoint.events 
      });
      
      return newEndpoint;
    } catch (error) {
      this.logger.error('Failed to register webhook endpoint', { error });
      throw new AppError('Failed to register webhook endpoint', '500');
    }
  }

  // Update an existing webhook endpoint
  public async updateEndpoint(id: string, update: Partial<Omit<WebhookEndpoint, 'id' | 'createdAt'>>): Promise<WebhookEndpoint> {
    try {
      const index = this.endpoints.findIndex(e => e.id === id);
      
      if (index === -1) {
        throw new AppError('Webhook endpoint not found', '404');
      }
      
      // Update the endpoint
      this.endpoints[index] = {
        ...this.endpoints[index],
        ...update,
      };
      
      // Persist to KV
      await this.persistEndpoints();
      
      this.logger.info('Updated webhook endpoint', { id });
      
      return this.endpoints[index];
    } catch (error) {
      this.logger.error('Failed to update webhook endpoint', { error, id });
      throw error instanceof AppError ? error : new AppError('Failed to update webhook endpoint', '500');
    }
  }

  // Delete a webhook endpoint
  public async deleteEndpoint(id: string): Promise<void> {
    try {
      const initialLength = this.endpoints.length;
      this.endpoints = this.endpoints.filter(e => e.id !== id);
      
      if (this.endpoints.length === initialLength) {
        throw new AppError('Webhook endpoint not found', '404');
      }
      
      // Persist to KV
      await this.persistEndpoints();
      
      this.logger.info('Deleted webhook endpoint', { id });
    } catch (error) {
      this.logger.error('Failed to delete webhook endpoint', { error, id });
      throw error instanceof AppError ? error : new AppError('Failed to delete webhook endpoint', '500');
    }
  }

  // Get all webhook endpoints
  public async getEndpoints(): Promise<WebhookEndpoint[]> {
    return this.endpoints;
  }

  // Get a webhook endpoint by ID
  public async getEndpoint(id: string): Promise<WebhookEndpoint | null> {
    return this.endpoints.find(e => e.id === id) || null;
  }

  // Trigger a webhook event for paste creation
  public async pasteCreated(paste: Paste): Promise<void> {
    const payload: WebhookPayload = {
      id: crypto.randomUUID(),
      event: 'paste.created',
      timestamp: new Date().toISOString(),
      data: {
        id: paste.getId().toString(),
        title: paste.getTitle(),
        language: paste.getLanguage(),
        visibility: paste.getVisibility(),
        createdAt: paste.getCreatedAt().toISOString(),
        expiresAt: paste.getExpiresAt().toISOString(),
        isEncrypted: paste.getIsEncrypted(),
        hasPassword: paste.hasPassword(),
        burnAfterReading: paste.isBurnAfterReading(),
        // Note: We don't include the content for security reasons
      },
    };

    await this.triggerWebhooks('paste.created', payload);
  }

  // Trigger a webhook event for paste viewing
  public async pasteViewed(paste: Paste): Promise<void> {
    const payload: WebhookPayload = {
      id: crypto.randomUUID(),
      event: 'paste.viewed',
      timestamp: new Date().toISOString(),
      data: {
        id: paste.getId().toString(),
        title: paste.getTitle(),
        language: paste.getLanguage(),
        visibility: paste.getVisibility(),
        createdAt: paste.getCreatedAt().toISOString(),
        expiresAt: paste.getExpiresAt().toISOString(),
        readCount: paste.getReadCount(),
      },
    };

    await this.triggerWebhooks('paste.viewed', payload);
  }

  // Trigger a webhook event for paste deletion
  public async pasteDeleted(pasteId: string): Promise<void> {
    const payload: WebhookPayload = {
      id: crypto.randomUUID(),
      event: 'paste.deleted',
      timestamp: new Date().toISOString(),
      data: {
        id: pasteId,
      },
    };

    await this.triggerWebhooks('paste.deleted', payload);
  }

  // Trigger a webhook event for paste expiration
  public async pasteExpired(pasteId: string): Promise<void> {
    const payload: WebhookPayload = {
      id: crypto.randomUUID(),
      event: 'paste.expired',
      timestamp: new Date().toISOString(),
      data: {
        id: pasteId,
      },
    };

    await this.triggerWebhooks('paste.expired', payload);
  }

  // Internal method to trigger webhooks for a specific event
  private async triggerWebhooks(event: WebhookEventType, payload: WebhookPayload): Promise<void> {
    // Get all active endpoints that are subscribed to this event
    const relevantEndpoints = this.endpoints.filter(
      e => e.isActive && e.events.includes(event)
    );

    if (relevantEndpoints.length === 0) {
      this.logger.debug('No webhook endpoints for event', { event });
      return;
    }

    this.logger.debug('Triggering webhooks', { 
      event, 
      endpointCount: relevantEndpoints.length,
      payloadId: payload.id
    });

    // Send the webhook to each endpoint in parallel
    const promises = relevantEndpoints.map(endpoint => 
      this.sendWebhook(endpoint, payload)
    );

    // Wait for all webhooks to be sent, but don't block on failures
    await Promise.allSettled(promises);
  }

  // Send a webhook to a specific endpoint
  private async sendWebhook(endpoint: WebhookEndpoint, payload: WebhookPayload): Promise<void> {
    try {
      // Convert payload to JSON string
      const payloadString = JSON.stringify(payload);
      
      // Generate signature using the endpoint's secret
      const signature = await this.generateSignature(endpoint.secret, payloadString);
      
      // Send the webhook
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-ID': payload.id,
          'User-Agent': 'Pasteriser-Webhook-Service/1.0',
        },
        body: payloadString,
      });

      if (!response.ok) {
        throw new Error(`Webhook failed with status ${response.status}`);
      }

      this.logger.debug('Webhook sent successfully', { 
        endpointId: endpoint.id, 
        payloadId: payload.id,
        status: response.status,
      });
    } catch (error) {
      this.logger.error('Failed to send webhook', { 
        error, 
        endpointId: endpoint.id,
        payloadId: payload.id,
        event: payload.event,
      });
      
      // We don't throw here to prevent one webhook failure from affecting others
    }
  }

  // Generate a signature for the payload using HMAC-SHA256
  private async generateSignature(secret: string, payload: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(payload)
    );
    
    // Convert signature to hex string
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Persist endpoints to KV storage
  private async persistEndpoints(): Promise<void> {
    try {
      await this.kvNamespace.put('webhook_endpoints', JSON.stringify(this.endpoints));
    } catch (error) {
      this.logger.error('Failed to persist webhook endpoints', { error });
      throw new AppError('Failed to persist webhook endpoints', '500');
    }
  }
}