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

/**
 * Aggregate stats returned by `getPublicStats()`. Mirrors the shape of
 * the `paste_stats()` Postgres function for the Supabase backend.
 */
export interface PasteStats {
  totalPublic: number;
  byLanguage: Array<{ language: string; count: number }>;
  byHour: Array<{ hour: string; count: number }>;
  /** Map from encryption version (as string, e.g. "0", "2") to count. */
  encryption: Record<string, number>;
  /** ISO timestamp of when the snapshot was generated. */
  generatedAt: string;
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
   * Delete a paste from the repository unconditionally. Used by internal
   * cleanup paths (none today) and the legacy delete flow that did its own
   * token check. Prefer {@link PasteRepository.deleteWithToken} for the
   * user-facing delete which checks the owner token atomically.
   * @returns true if the paste existed and was deleted, false if not found
   */
  delete(id: PasteId): Promise<boolean>;

  /**
   * Atomic delete-with-token. Single round-trip happy path: takes a row
   * lock, compares the stored `delete_token` against the supplied
   * `ownerToken`, and deletes the row only if they match.
   *
   * Returns a discriminated result so the caller can map:
   *   - {found:false, deleted:false} → 404 not_found
   *   - {found:true,  deleted:false} → 403 unauthorized
   *   - {found:true,  deleted:true}  → 200 success
   *
   * Backed by the `delete_paste(uuid, uuid)` Postgres function in the
   * Supabase implementation (see migration 20260513170000). The token is
   * expected to be a UUID; non-UUID input results in {found:false}.
   */
  deleteWithToken(id: PasteId, ownerToken: string): Promise<{ found: boolean; deleted: boolean }>;

  /**
   * Find recent public pastes
   * @param limit Maximum number of pastes to return
   * @returns A promise that resolves to an array of pastes
   */
  findRecentPublic(limit: number): Promise<Paste[]>;

  /**
   * Full-text search across public pastes by title + language.
   *
   * Backed by a Postgres tsvector + GIN index in the Supabase implementation
   * (uses websearch_to_tsquery for Google-style query parsing: phrases,
   * boolean operators, exclusions).
   *
   * KV implementation returns an empty array (no search primitive).
   *
   * @param query User query string. Empty/whitespace returns [].
   * @param limit Maximum results to return.
   * @returns Matching pastes ordered by relevance (rank desc) where supported,
   *          else by created_at desc.
   */
  searchPublic(query: string, limit: number): Promise<Paste[]>;

  /**
   * Aggregate stats over public pastes: total count, by language (top 20),
   * by hour (last 48h), encryption-version breakdown.
   *
   * Backed by the `paste_stats()` Postgres function in the Supabase
   * implementation. KV returns null (no aggregation primitive).
   */
  getPublicStats(): Promise<PasteStats | null>;

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
