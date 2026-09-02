import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type {
  User,
  Permission,
  LoginCredentials,
  ForgotPasswordRequest,
  SetPasswordRequest,
  ApiResponse,
} from '../../domain/entities/User';
import type { Dependencies } from '../../app/dependencies';
import { AxiosError } from 'axios';

interface AuthState {
  user: User | null;
  permissions: Permission[];
  permissionsLoaded: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  successMessage: string | null;
}

const initialState: AuthState = {
  user: null,
  permissions: [],
  permissionsLoaded: false,
  accessToken: null,
  refreshToken: null,
  isLoading: false,
  error: null,
  isAuthenticated: false,
  successMessage: null,
};

function extractErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as ApiResponse | undefined;
    if (data?.message) return data.message;
  }
  if (error instanceof Error) return error.message;
  return 'An unknown error occurred';
}

// -- Login --
export const loginAsync = createAsyncThunk<
  { user: User; accessToken: string; refreshToken: string },
  LoginCredentials,
  { extra: Dependencies }
>('auth/login', async (credentials, { extra, rejectWithValue }) => {
  try {
    const auth = extra.auth();
    const response = await auth.loginUseCase.execute(credentials);
    extra.infrastructure.storageRepository.setItem('token', response.accessToken);
    extra.infrastructure.storageRepository.setItem('refreshToken', response.refreshToken);
    // Fetch full user profile (with permissions) immediately after login
    const meResponse = await auth.authRepository.getCurrentUser();
    extra.infrastructure.storageRepository.setItem('user', JSON.stringify(meResponse.data));
    return {
      user: meResponse.data,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    };
  } catch (error: unknown) {
    return rejectWithValue(extractErrorMessage(error));
  }
});

// -- Forgot Password --
export const forgotPasswordAsync = createAsyncThunk<
  ApiResponse,
  ForgotPasswordRequest,
  { extra: Dependencies }
>('auth/forgotPassword', async (data, { extra, rejectWithValue }) => {
  try {
    const auth = extra.auth();
    const response = await auth.forgotPasswordUseCase.execute(data);
    if (!response.success) {
      return rejectWithValue(response.message);
    }
    return response;
  } catch (error: unknown) {
    return rejectWithValue(extractErrorMessage(error));
  }
});

// -- Set Password (Reset) --
export const setPasswordAsync = createAsyncThunk<
  ApiResponse,
  SetPasswordRequest,
  { extra: Dependencies }
>('auth/setPassword', async (data, { extra, rejectWithValue }) => {
  try {
    const auth = extra.auth();
    const response = await auth.setPasswordUseCase.execute(data);
    if (!response.success) {
      return rejectWithValue(response.message);
    }
    return response;
  } catch (error: unknown) {
    return rejectWithValue(extractErrorMessage(error));
  }
});

// -- Fetch Current User (/api/users/me) --
export const fetchCurrentUserAsync = createAsyncThunk<User, void, { extra: Dependencies }>(
  'auth/fetchCurrentUser',
  async (_, { extra, rejectWithValue }) => {
    try {
      const auth = extra.auth();
      const response = await auth.authRepository.getCurrentUser();
      return response.data;
    } catch (error: unknown) {
      return rejectWithValue(extractErrorMessage(error));
    }
  }
);

// -- Logout --
export const logoutAsync = createAsyncThunk<void, void, { extra: Dependencies }>(
  'auth/logout',
  async (_, { extra }) => {
    try {
      const auth = extra.auth();
      await auth.authRepository.logout();
    } catch (error) {
      console.error('Logout API call failed:', error);
    } finally {
      extra.infrastructure.storageRepository.removeItem('token');
      extra.infrastructure.storageRepository.removeItem('refreshToken');
      extra.infrastructure.storageRepository.removeItem('user');
    }
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout: (state) => {
      state.user = null;
      state.accessToken = null;
      state.refreshToken = null;
      state.isAuthenticated = false;
      state.error = null;
      state.successMessage = null;
    },
    hydrateAuth: (state, action: PayloadAction<{ token: string | null; user: string | null }>) => {
      const { token, user } = action.payload;
      state.accessToken = token;
      state.isAuthenticated = !!token;
      if (user) {
        try {
          const parsed = JSON.parse(user);
          state.user = parsed;
          state.permissions = parsed?.permissions ?? [];
          state.permissionsLoaded = true;
        } catch {
          state.user = null;
        }
      }
    },
    clearError: (state) => {
      state.error = null;
    },
    clearSuccessMessage: (state) => {
      state.successMessage = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // -- Login --
      .addCase(loginAsync.pending, (state) => {
        state.isLoading = true;
        state.error = null;
        state.successMessage = null;
      })
      .addCase(loginAsync.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload.user;
        state.permissions = action.payload.user.permissions ?? [];
        state.permissionsLoaded = true;
        state.accessToken = action.payload.accessToken;
        state.refreshToken = action.payload.refreshToken;
        state.isAuthenticated = true;
        state.error = null;
      })
      .addCase(loginAsync.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
        state.isAuthenticated = false;
      })

      // -- Forgot Password --
      .addCase(forgotPasswordAsync.pending, (state) => {
        state.isLoading = true;
        state.error = null;
        state.successMessage = null;
      })
      .addCase(forgotPasswordAsync.fulfilled, (state, action) => {
        state.isLoading = false;
        state.successMessage = action.payload.message;
        state.error = null;
      })
      .addCase(forgotPasswordAsync.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })

      // -- Set Password --
      .addCase(setPasswordAsync.pending, (state) => {
        state.isLoading = true;
        state.error = null;
        state.successMessage = null;
      })
      .addCase(setPasswordAsync.fulfilled, (state, action) => {
        state.isLoading = false;
        state.successMessage = action.payload.message;
        state.error = null;
      })
      .addCase(setPasswordAsync.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })

      // -- Fetch Current User --
      .addCase(fetchCurrentUserAsync.fulfilled, (state, action) => {
        state.user = action.payload;
        state.permissions = action.payload.permissions ?? [];
        state.permissionsLoaded = true;
      })

      // -- Logout --
      .addCase(logoutAsync.fulfilled, (state) => {
        state.user = null;
        state.permissions = [];
        state.permissionsLoaded = false;
        state.accessToken = null;
        state.refreshToken = null;
        state.isAuthenticated = false;
        state.error = null;
        state.successMessage = null;
      });
  },
});

export const { logout, hydrateAuth, clearError, clearSuccessMessage } = authSlice.actions;
export default authSlice.reducer;
