import type { AxiosInstance } from 'axios';
import type { StorageRepository } from '../../domain/repositories/StorageRepository';
import type { AuthRepository } from '../../domain/repositories/AuthRepository';
import type { LoginUseCase } from '../../domain/usecases/LoginUseCase';
import type { ForgotPasswordUseCase } from '../../domain/usecases/ForgotPasswordUseCase';
import type { SetPasswordUseCase } from '../../domain/usecases/SetPasswordUseCase';
import type { ModbusRepository } from '../../domain/repositories/ModbusRepository';
import type { ConnectModbusUseCase } from '../../domain/usecases/ConnectModbusUseCase';
import type { DisconnectModbusUseCase } from '../../domain/usecases/DisconnectModbusUseCase';

/**
 * Shared infrastructure dependencies available to all features.
 */
export interface InfrastructureDependencies {
  storageRepository: StorageRepository;
  apiClient: AxiosInstance;
  onUnauthorized: () => void;
}

/**
 * Auth feature dependencies - lazily initialized.
 */
export interface AuthDependencies {
  authRepository: AuthRepository;
  loginUseCase: LoginUseCase;
  forgotPasswordUseCase: ForgotPasswordUseCase;
  setPasswordUseCase: SetPasswordUseCase;
}

/**
 * Modbus feature dependencies - lazily initialized.
 */
export interface ModbusDependencies {
  modbusRepository: ModbusRepository;
  connectModbusUseCase: ConnectModbusUseCase;
  disconnectModbusUseCase: DisconnectModbusUseCase;
}

/**
 * Main dependencies container for the application.
 * Infrastructure is eagerly loaded, features are lazy-loaded.
 */
export interface Dependencies {
  infrastructure: InfrastructureDependencies;
  auth: LazyDependency<AuthDependencies>;
  modbus: LazyDependency<ModbusDependencies>;
}

/**
 * Lazy dependency wrapper - creates instance on first access.
 */
export interface LazyDependency<T> {
  (): T;
}

/**
 * Configuration for initializing the dependency container.
 */
export interface DependenciesConfig {
  onUnauthorized: () => void;
}
