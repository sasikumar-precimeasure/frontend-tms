import type { LoginCredentials, LoginResponse } from '../entities/User';
import type { AuthRepository } from '../repositories/AuthRepository';

export class LoginUseCase {
  private authRepository: AuthRepository;

  constructor(authRepository: AuthRepository) {
    this.authRepository = authRepository;
  }

  async execute(credentials: LoginCredentials): Promise<LoginResponse> {
    return this.authRepository.login(credentials);
  }
}
