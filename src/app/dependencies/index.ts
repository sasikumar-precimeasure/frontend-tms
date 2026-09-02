import { createInfrastructure } from './infrastructure';
import { createAuthDependencies } from './features/auth';
import { createModbusDependencies } from './features/modbus';
import type {
  Dependencies,
  DependenciesConfig,
  InfrastructureDependencies,
  AuthDependencies,
  ModbusDependencies,
} from './types';

// Re-export types for convenience
export type {
  Dependencies,
  DependenciesConfig,
  InfrastructureDependencies,
  AuthDependencies,
  ModbusDependencies,
};

function createLazyDependency<T>(factory: () => T): () => T {
  let cached: T | null = null;

  return () => {
    if (cached === null) {
      cached = factory();
    }
    return cached;
  };
}

export function createDependencies(config: DependenciesConfig): Dependencies {
  // Eager: Infrastructure is always needed
  const infrastructure = createInfrastructure(config);

  // Lazy: Feature dependencies created on first access
  const auth = createLazyDependency(() => createAuthDependencies(infrastructure));
  const modbus = createLazyDependency(() => createModbusDependencies());

  return {
    infrastructure,
    auth,
    modbus,
  };
}

/**
 * Global reference to the dependency container.
 * Set once at application startup, used throughout the app.
 *
 * This is initialized in main.tsx and should never be modified after that.
 */
export let dependencies: Dependencies;

export function initializeDependencies(config: DependenciesConfig): void {
  dependencies = createDependencies(config);
}
