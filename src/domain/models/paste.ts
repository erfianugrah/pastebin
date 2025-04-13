import { z } from 'zod';

export const VisibilityEnum = z.enum(['public', 'private']);
export type Visibility = z.infer<typeof VisibilityEnum>;

export class PasteId {
  private constructor(private readonly value: string) {}

  static create(value: string): PasteId {
    return new PasteId(value);
  }

  toString(): string {
    return this.value;
  }

  equals(other: PasteId): boolean {
    return this.value === other.value;
  }
}

export class ExpirationPolicy {
  private constructor(private readonly seconds: number) {}

  static create(seconds: number): ExpirationPolicy {
    if (seconds <= 0) {
      throw new Error('Expiration must be greater than 0');
    }
    return new ExpirationPolicy(seconds);
  }

  static createDefault(): ExpirationPolicy {
    // Default: 1 day
    return new ExpirationPolicy(86400);
  }

  static createNever(): ExpirationPolicy {
    // Effectively never expires (10 years)
    return new ExpirationPolicy(315360000);
  }

  getSeconds(): number {
    return this.seconds;
  }

  getExpirationDate(fromDate: Date = new Date()): Date {
    const expirationDate = new Date(fromDate);
    expirationDate.setSeconds(expirationDate.getSeconds() + this.seconds);
    return expirationDate;
  }

  hasExpired(creationDate: Date, currentDate: Date = new Date()): boolean {
    const expirationDate = this.getExpirationDate(creationDate);
    return currentDate >= expirationDate;
  }
}

export class Paste {
  constructor(
    private readonly id: PasteId,
    private readonly content: string,
    private readonly createdAt: Date,
    private readonly expirationPolicy: ExpirationPolicy,
    private readonly title?: string,
    private readonly language?: string,
    private readonly visibility: Visibility = 'public',
    // passwordHash field is removed in Phase 4
    private readonly burnAfterReading: boolean = false,
    private readonly readCount: number = 0,
    private readonly isEncrypted: boolean = false,
    private readonly viewLimit?: number,
    private readonly version: number = 0, // 0=plaintext, 1=server-side password, 2=client-side encryption
  ) {}

  static create(
    id: PasteId,
    content: string,
    expirationPolicy: ExpirationPolicy = ExpirationPolicy.createDefault(),
    title?: string,
    language?: string,
    visibility: Visibility = 'public',
    // passwordHash parameter removed in Phase 4
    burnAfterReading: boolean = false,
    isEncrypted: boolean = false,
    viewLimit?: number,
    version: number = 0, // 0=plaintext, 1=server-side pw, 2=client-side encryption
  ): Paste {
    // Infer version if not explicitly provided
    if (version === 0) {
      if (isEncrypted) {
        version = 2; // Client-side encryption
      }
      // Otherwise remains 0 (plaintext)
    }
    
    // Phase 4: All new pastes are at least version 2 (client-side encryption)
    if (version < 2) {
      version = 2;
    }

    return new Paste(
      id,
      content,
      new Date(),
      expirationPolicy,
      title,
      language,
      visibility,
      // passwordHash parameter removed in Phase 4
      burnAfterReading,
      0, // readCount starts at 0
      isEncrypted,
      viewLimit,
      version,
    );
  }

  getId(): PasteId {
    return this.id;
  }

  getContent(): string {
    return this.content;
  }

  getTitle(): string | undefined {
    return this.title;
  }

  getLanguage(): string | undefined {
    return this.language;
  }

  getCreatedAt(): Date {
    return this.createdAt;
  }

  getExpirationPolicy(): ExpirationPolicy {
    return this.expirationPolicy;
  }

  getExpiresAt(): Date {
    return this.expirationPolicy.getExpirationDate(this.createdAt);
  }

  getVisibility(): Visibility {
    return this.visibility;
  }

  hasExpired(currentDate: Date = new Date()): boolean {
    return this.expirationPolicy.hasExpired(this.createdAt, currentDate);
  }
  
  // All password-related methods have been removed in the final cleanup
  
  isBurnAfterReading(): boolean {
    return this.burnAfterReading;
  }
  
  getReadCount(): number {
    return this.readCount;
  }
  
  incrementReadCount(): Paste {
    return new Paste(
      this.id,
      this.content,
      this.createdAt,
      this.expirationPolicy,
      this.title,
      this.language,
      this.visibility,
      this.burnAfterReading,
      this.readCount + 1,
      this.isEncrypted,
      this.viewLimit,
      this.version
    );
  }
  
  shouldBurn(): boolean {
    return this.burnAfterReading && this.readCount > 0;
  }
  
  // Password verification method has been removed in the final cleanup
  
  // Helper method to identify client-side encrypted content
  isClientSideEncrypted(): boolean {
    // Phase 4: All encrypted content must use client-side encryption
    // This returns true for all encrypted content and also version >= 2
    return this.isEncrypted === true || this.version >= 2;
  }

  getIsEncrypted(): boolean {
    // Phase 4: All version 2+ pastes are considered encrypted
    return this.isEncrypted || this.version >= 2;
  }
  
  getVersion(): number {
    return this.version;
  }
  
  /**
   * Get security type of the paste in a human-readable format
   * @returns Security type string
   */
  getSecurityType(): string {
    if (this.version >= 2 || this.isEncrypted) {
      return 'E2E Encrypted';
    } else {
      // Phase 4: All new pastes are either plaintext or E2E encrypted
      return 'Public';
    }
  }
  
  getViewLimit(): number | undefined {
    return this.viewLimit;
  }
  
  hasViewLimit(): boolean {
    return typeof this.viewLimit === 'number' && this.viewLimit > 0;
  }
  
  hasReachedViewLimit(): boolean {
    if (!this.hasViewLimit()) {
      return false;
    }
    
    return this.readCount >= (this.viewLimit as number);
  }

  toJSON(_includePasswordHash = false) {
    // Phase 4: Password hashes are completely removed
    const json = {
      id: this.id.toString(),
      content: this.content,
      title: this.title,
      language: this.language,
      createdAt: this.createdAt.toISOString(),
      expiresAt: this.getExpiresAt().toISOString(),
      visibility: this.visibility,
      // isPasswordProtected field removed in final cleanup
      burnAfterReading: this.burnAfterReading,
      readCount: this.readCount,
      isEncrypted: this.isEncrypted || this.version >= 2, // Consider all v2+ pastes encrypted
      hasViewLimit: this.hasViewLimit(),
      viewLimit: this.viewLimit,
      remainingViews: this.hasViewLimit() ? Math.max(0, (this.viewLimit as number) - this.readCount) : null,
      version: this.version, // Include encryption version
      securityType: this.getSecurityType(), // Human-readable security description
    };
    
    return json;
  }
  
  // Method to create a version of the paste without content (for listing)
  toSummary() {
    return {
      id: this.id.toString(),
      title: this.title,
      language: this.language,
      createdAt: this.createdAt.toISOString(),
      expiresAt: this.getExpiresAt().toISOString(),
      visibility: this.visibility,
      // isPasswordProtected field removed in final cleanup
      burnAfterReading: this.burnAfterReading,
      isEncrypted: this.isEncrypted || this.version >= 2, // Consider all v2+ pastes encrypted
      hasViewLimit: this.hasViewLimit(),
      viewLimit: this.viewLimit,
      remainingViews: this.hasViewLimit() ? Math.max(0, (this.viewLimit as number) - this.readCount) : null,
      readCount: this.readCount,
      version: this.version,
      securityType: this.getSecurityType(),
    };
  }
}

export interface PasteData {
  id: string;
  content: string;
  title?: string;
  language?: string;
  createdAt: string;
  expiresAt: string;
  visibility: Visibility;
  // passwordHash and isPasswordProtected fields removed in final cleanup
  burnAfterReading?: boolean;
  readCount?: number;
  isEncrypted?: boolean;
  viewLimit?: number;
  hasViewLimit?: boolean;
  remainingViews?: number | null;
  version?: number; // Encryption version: 0=plaintext, 1=server-side, 2=client-side
  securityType?: string; // Human-readable security description
}
