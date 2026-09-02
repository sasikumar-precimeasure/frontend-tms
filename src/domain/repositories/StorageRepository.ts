/**
 * Repository interface for storage operations.
 * Domain layer defines the contract, infrastructure provides implementation.
 */
export interface StorageRepository {
  getItem(key: string): string | null;

  setItem(key: string, value: string): void;

  removeItem(key: string): void;

  clear(): void;
}
