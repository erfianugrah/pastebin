import { Paste, PasteId } from '../models/paste';

/**
 * Result of a view() operation. Encodes both whether the paste was found
 * and any policy-driven side effects that occurred (burn-after-reading,
 * view-limit reached).
 */
export interface ViewResult {
  /** The paste content, or null if not found / expired / already at view limit */
  paste: Paste | null;
  /** True if this view triggered burn-after-reading (row was deleted) */
  wasBurned: boolean;
  /** True if this view hit the view_limit cap (row was deleted) */
  wasViewLimited: boolean;
}

export interface PasteRepository {
  /**
   * Save a paste to the repository
   * @param paste The paste to save
   * @returns A promise that resolves when the paste is saved
   */
  save(paste: Paste): Promise<void>;

  /**
   * Find a paste by its ID. Read-only, no side effects.
   * @param id The ID of the paste to find
   * @returns A promise that resolves to the paste, or null if not found
   */
  findById(id: PasteId): Promise<Paste | null>;

  /**
   * View a paste: read content, increment read_count, enforce burn-after-
   * reading and view_limit policies. Atomic where the storage layer supports
   * row locks (Supabase via the `view_paste()` Postgres function); best-
   * effort with documented race conditions on eventually-consistent stores
   * (Cloudflare KV).
   *
   * @param id The ID of the paste to view
   * @returns The view result. paste === null on not-found, expired, or
   *          already-at-view-limit.
   */
  view(id: PasteId): Promise<ViewResult>;

  /**
   * Delete a paste from the repository
   * @param id The ID of the paste to delete
   * @returns A promise that resolves to true if the paste was deleted, false if not found
   */
  delete(id: PasteId): Promise<boolean>;

  /**
   * Find recent public pastes
   * @param limit Maximum number of pastes to return
   * @returns A promise that resolves to an array of pastes
   */
  findRecentPublic(limit: number): Promise<Paste[]>;

  /**
   * Resolve a vanity slug to a paste ID
   * @returns The paste ID or null if not found
   */
  resolveSlug(slug: string): Promise<string | null>;

  /**
   * Save a vanity slug -> paste ID mapping
   */
  saveSlug(slug: string, pasteId: string, expiresAt: Date): Promise<void>;
}
