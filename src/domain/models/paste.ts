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
    let resolvedVersion = version;
    if (!isEncrypted) {
      resolvedVersion = 0;
    } else if (resolvedVersion < 2) {
      resolvedVersion = 2;
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
      resolvedVersion,
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
    // Phase 4: Check if content is encrypted AND uses client-side encryption
    return this.isEncrypted === true && this.version >= 2;
  }

  getIsEncrypted(): boolean {
    // In Phase 4, we respect the explicit isEncrypted flag
    // Version is just metadata about the encryption method used (if any)
    return this.isEncrypted;
  }
  
  getVersion(): number {
    return this.version;
  }
  
  /**
   * Get security type of the paste in a human-readable format
   * @returns Security type string
   */
  getSecurityType(): string {
    if (this.isEncrypted && this.version >= 2) {
      return 'E2E Encrypted';
    } else if (this.isEncrypted && this.version < 2) {
      return 'Legacy Encrypted';
    } else {
      return this.visibility === 'public' ? 'Public' : 'Private';
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
      isEncrypted: this.isEncrypted, // Use the explicit encryption flag
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
      isEncrypted: this.isEncrypted, // Use the explicit encryption flag
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
