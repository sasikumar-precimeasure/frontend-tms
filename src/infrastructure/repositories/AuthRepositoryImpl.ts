import type { AxiosInstance } from 'axios';
import type { AuthRepository } from '../../domain/repositories/AuthRepository';
import type {
  User,
  LoginCredentials,
  LoginResponse,
  ForgotPasswordRequest,
  SetPasswordRequest,
  ApiResponse,
} from '../../domain/entities/User';

export class AuthRepositoryImpl implements AuthRepository {
  private apiClient: AxiosInstance;

  constructor(apiClient: AxiosInstance) {
    this.apiClient = apiClient;
  }

  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const response = await this.apiClient.post<LoginResponse>('/tms/api/auth/login', credentials);
    return response.data;
  }

  async forgotPassword(data: ForgotPasswordRequest): Promise<ApiResponse> {
    const response = await this.apiClient.post<ApiResponse>(
      '/tms/api/auth/forgot-password',
      data
    );
    return response.data;
  }

  async setPassword(data: SetPasswordRequest): Promise<ApiResponse> {
    const response = await this.apiClient.post<ApiResponse>('/tms/api/auth/reset-password', data);
    return response.data;
  }

  async logout(): Promise<void> {
    await this.apiClient.post('/tms/api/auth/logout');
  }

  async getCurrentUser(): Promise<ApiResponse<User>> {
    const response = await this.apiClient.get<ApiResponse<User>>('/tms/api/users/me');
    return response.data;
  }
}
