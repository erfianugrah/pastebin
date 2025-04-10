import { Paste, PasteId } from '../models/paste';

export interface PasteRepository {
  /**
   * Save a paste to the repository
   * @param paste The paste to save
   * @returns A promise that resolves when the paste is saved
   */
  save(paste: Paste): Promise<void>;

  /**
   * Find a paste by its ID
   * @param id The ID of the paste to find
   * @returns A promise that resolves to the paste, or null if not found
   */
  findById(id: PasteId): Promise<Paste | null>;

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
}
