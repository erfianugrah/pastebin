import { Env } from '../../types';
import { Logger } from '../logging/logger';

export interface AnalyticsEvent {
  type: string;
  data: Record<string, any>;
  timestamp: number;
  requestId?: string;
}

/**
 * Simple analytics system that stores events in KV storage
 */
export class Analytics {
  constructor(
    private readonly env: Env,
    private readonly logger: Logger
  ) {}

  /**
   * Track an event that occurred in the application
   * @param type Event type (e.g., 'paste_created', 'paste_viewed')
   * @param data Additional data about the event
   * @param requestId Optional request ID for correlation
   */
  async trackEvent(
    type: string, 
    data: Record<string, any>,
    requestId?: string
  ): Promise<void> {
    try {
      const event: AnalyticsEvent = {
        type,
        data,
        timestamp: Date.now(),
        requestId
      };

      // Create a key with date and time components for easier querying
      const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const key = `analytics:${date}:${crypto.randomUUID()}`;
      
      // Store in KV with a TTL of 30 days
      await this.env.PASTES.put(key, JSON.stringify(event), {
        expirationTtl: 60 * 60 * 24 * 30 // 30 days
      });

      this.logger.debug('Analytics event tracked', { type, data });
    } catch (error) {
      // Log but don't fail if analytics tracking fails
      this.logger.error('Failed to track analytics event', { error, type, data });
    }
  }

  /**
   * Get daily analytics stats
   * @param date Date in YYYY-MM-DD format
   */
  async getDailyStats(date: string): Promise<Record<string, number>> {
    try {
      // List all analytics events for the given date
      const { keys } = await this.env.PASTES.list({ prefix: `analytics:${date}:` });
      
      const stats: Record<string, number> = {};
      
      // Process each event to build statistics
      for (const key of keys) {
        const eventData = await this.env.PASTES.get(key.name);
        if (eventData) {
          const event: AnalyticsEvent = JSON.parse(eventData);
          stats[event.type] = (stats[event.type] || 0) + 1;
        }
      }
      
      return stats;
    } catch (error) {
      this.logger.error('Failed to get daily stats', { error, date });
      return {};
    }
  }

  /**
   * Get statistics for the last N days
   * @param days Number of days to get stats for
   */
  async getRecentStats(days: number = 7): Promise<Record<string, Record<string, number>>> {
    const result: Record<string, Record<string, number>> = {};
    
    // Generate date strings for the last N days
    const dates = Array.from({ length: days }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - i);
      return date.toISOString().split('T')[0]; // YYYY-MM-DD
    });
    
    // Get stats for each day
    for (const date of dates) {
      result[date] = await this.getDailyStats(date);
    }
    
    return result;
  }
}