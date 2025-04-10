import { ExpirationPolicy } from '../models/paste';

export interface ExpirationService {
  /**
   * Create an expiration policy from a number of seconds
   * @param seconds Number of seconds until expiration
   * @returns An expiration policy
   */
  createFromSeconds(seconds: number): ExpirationPolicy;

  /**
   * Create a default expiration policy
   * @returns The default expiration policy
   */
  createDefault(): ExpirationPolicy;

  /**
   * Create an expiration policy that never expires
   * @returns An expiration policy that never expires
   */
  createNever(): ExpirationPolicy;
}

export class DefaultExpirationService implements ExpirationService {
  createFromSeconds(seconds: number): ExpirationPolicy {
    return ExpirationPolicy.create(seconds);
  }

  createDefault(): ExpirationPolicy {
    return ExpirationPolicy.createDefault();
  }

  createNever(): ExpirationPolicy {
    return ExpirationPolicy.createNever();
  }
}
