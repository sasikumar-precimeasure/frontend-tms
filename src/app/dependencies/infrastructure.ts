import { StorageRepositoryImpl } from '../../infrastructure/repositories/StorageRepositoryImpl';
import { createApiClient } from '../../infrastructure/api/client';
import type { InfrastructureDependencies, DependenciesConfig } from './types';

export function createInfrastructure(config: DependenciesConfig): InfrastructureDependencies {
  const { onUnauthorized } = config;

  // Storage repository - wraps localStorage
  const storageRepository = new StorageRepositoryImpl();

  // API client - axios instance with auth interceptors
  const apiClient = createApiClient({
    storageRepository,
    onUnauthorized,
  });

  return {
    storageRepository,
    apiClient,
    onUnauthorized,
  };
}
