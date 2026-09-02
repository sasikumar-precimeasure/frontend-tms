import type { ForgotPasswordRequest, ApiResponse } from '../entities/User';
import type { AuthRepository } from '../repositories/AuthRepository';

export class ForgotPasswordUseCase {
  private authRepository: AuthRepository;

  constructor(authRepository: AuthRepository) {
    this.authRepository = authRepository;
  }

  async execute(data: ForgotPasswordRequest): Promise<ApiResponse> {
    return this.authRepository.forgotPassword(data);
  }
}
