import { AuthRepositoryImpl } from '../../../infrastructure/repositories/AuthRepositoryImpl';
import { LoginUseCase } from '../../../domain/usecases/LoginUseCase';
import { ForgotPasswordUseCase } from '../../../domain/usecases/ForgotPasswordUseCase';
import { SetPasswordUseCase } from '../../../domain/usecases/SetPasswordUseCase';
import type { InfrastructureDependencies, AuthDependencies } from '../types';

export function createAuthDependencies(
  infrastructure: InfrastructureDependencies
): AuthDependencies {
  const { apiClient } = infrastructure;

  const authRepository = new AuthRepositoryImpl(apiClient);

  const loginUseCase = new LoginUseCase(authRepository);
  const forgotPasswordUseCase = new ForgotPasswordUseCase(authRepository);
  const setPasswordUseCase = new SetPasswordUseCase(authRepository);

  return {
    authRepository,
    loginUseCase,
    forgotPasswordUseCase,
    setPasswordUseCase,
  };
}
