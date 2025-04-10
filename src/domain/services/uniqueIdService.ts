import { PasteId } from '../models/paste';

export interface UniqueIdService {
  /**
   * Generate a new unique ID for a paste
   * @returns A promise that resolves to a unique ID
   */
  generateId(): Promise<PasteId>;
}
