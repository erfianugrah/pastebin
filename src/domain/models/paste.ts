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
    private readonly passwordHash?: string,
    private readonly burnAfterReading: boolean = false,
    private readonly readCount: number = 0,
  ) {}

  static create(
    id: PasteId,
    content: string,
    expirationPolicy: ExpirationPolicy = ExpirationPolicy.createDefault(),
    title?: string,
    language?: string,
    visibility: Visibility = 'public',
    passwordHash?: string,
    burnAfterReading: boolean = false,
  ): Paste {
    return new Paste(
      id,
      content,
      new Date(),
      expirationPolicy,
      title,
      language,
      visibility,
      passwordHash,
      burnAfterReading,
      0, // readCount starts at 0
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
  
  hasPassword(): boolean {
    return !!this.passwordHash;
  }
  
  getPasswordHash(): string | undefined {
    return this.passwordHash;
  }
  
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
      this.passwordHash,
      this.burnAfterReading,
      this.readCount + 1
    );
  }
  
  shouldBurn(): boolean {
    return this.burnAfterReading && this.readCount > 0;
  }
  
  async isPasswordCorrect(passwordToCheck: string): Promise<boolean> {
    if (!this.passwordHash) {
      return true; // No password set
    }
    
    // Use the WebCrypto API to generate a secure hash
    const hash = await this.hashPassword(passwordToCheck);
    return hash === this.passwordHash;
  }
  
  private async hashPassword(password: string): Promise<string> {
    // Use WebCrypto API for better security
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    
    // Use SHA-256 algorithm
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    
    // Convert buffer to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hashHex;
  }

  toJSON(includePasswordHash = false) {
    const json = {
      id: this.id.toString(),
      content: this.content,
      title: this.title,
      language: this.language,
      createdAt: this.createdAt.toISOString(),
      expiresAt: this.getExpiresAt().toISOString(),
      visibility: this.visibility,
      isPasswordProtected: this.hasPassword(),
      burnAfterReading: this.burnAfterReading,
      readCount: this.readCount,
    };

    // Only include password hash for storage, not for API responses
    if (includePasswordHash && this.passwordHash) {
      return {
        ...json,
        passwordHash: this.passwordHash
      };
    }
    
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
      isPasswordProtected: this.hasPassword(),
      burnAfterReading: this.burnAfterReading,
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
  passwordHash?: string;
  isPasswordProtected?: boolean;
  burnAfterReading?: boolean;
  readCount?: number;
}
