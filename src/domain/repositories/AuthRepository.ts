import type {
  User,
  LoginCredentials,
  LoginResponse,
  ForgotPasswordRequest,
  SetPasswordRequest,
  ApiResponse,
} from '../entities/User';

export interface AuthRepository {
  login(credentials: LoginCredentials): Promise<LoginResponse>;
  forgotPassword(data: ForgotPasswordRequest): Promise<ApiResponse>;
  setPassword(data: SetPasswordRequest): Promise<ApiResponse>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<ApiResponse<User>>;
}
