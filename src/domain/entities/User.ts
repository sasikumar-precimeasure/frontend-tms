// -- API Response wrapper --
export interface ApiResponse<T = unknown> {
  success: boolean;
  title: string | null;
  message: string;
  data: T;
  timestamp: string;
}

// -- Role --
export interface Role {
  id: number;
  name: string;
  status: boolean;
}

// -- Permission --
export interface Permission {
  menu: string;
  function: string;
  read: boolean;
  write: boolean;
}

// -- User --
export interface User {
  id: number;
  userName: string;
  fullName: string | null;
  email: string;
  mobile: string | null;
  status: boolean;
  created_date: string;
  lastLoginAt: string | null;
  roleId: number | null;
  role: Role | null;
  permissions: Permission[];
  imgUrl: string | null;
  timezone: string | null;
  date_format: string | null;
}

// -- Login --
export interface LoginCredentials {
  username: string;
  password: string;
  rememberMe: boolean;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  user: User;
}

// -- Forgot Password --
export interface ForgotPasswordRequest {
  email: string;
}

// -- Set / Reset Password --
export interface SetPasswordRequest {
  newPassword: string;
  confirmPassword: string;
  token: string;
}

// -- Refresh Token --
export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  user: User;
}
