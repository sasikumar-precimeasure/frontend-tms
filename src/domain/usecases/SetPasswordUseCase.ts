import type { SetPasswordRequest, ApiResponse } from '../entities/User';
import type { AuthRepository } from '../repositories/AuthRepository';

export class SetPasswordUseCase {
  private authRepository: AuthRepository;

  constructor(authRepository: AuthRepository) {
    this.authRepository = authRepository;
  }

  async execute(data: SetPasswordRequest): Promise<ApiResponse> {
    return this.authRepository.setPassword(data);
  }
}
