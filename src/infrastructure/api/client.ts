import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import type { StorageRepository } from '../../domain/repositories/StorageRepository';
import type { RefreshTokenResponse } from '../../domain/entities/User';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.example.com';

export interface ApiClientConfig {
  storageRepository: StorageRepository;
  onUnauthorized?: () => void;
}

interface FailedRequest {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}

export function createApiClient(config: ApiClientConfig): AxiosInstance {
  const { storageRepository, onUnauthorized } = config;

  let isRefreshing = false;
  let failedQueue: FailedRequest[] = [];

  function processQueue(error: unknown, token: string | null) {
    failedQueue.forEach((req) => {
      if (token) {
        req.resolve(token);
      } else {
        req.reject(error);
      }
    });
    failedQueue = [];
  }

  const client = axios.create({
    baseURL: API_BASE_URL,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor: attach access token
  client.interceptors.request.use(
    (requestConfig) => {
      const token = storageRepository.getItem('token');
      if (token) {
        requestConfig.headers.Authorization = `Bearer ${token}`;
      }
      return requestConfig;
    },
    (error) => Promise.reject(error)
  );

  // Response interceptor: on 401 → refresh token → retry original request
  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

      if (
        error.response?.status !== 401 ||
        originalRequest._retry ||
        originalRequest.url === '/tms/api/auth/refresh' ||
        originalRequest.url === '/tms/api/auth/login'
      ) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((newToken) => {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return client(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = storageRepository.getItem('refreshToken');

      if (!refreshToken) {
        isRefreshing = false;
        processQueue(error, null);
        storageRepository.removeItem('token');
        storageRepository.removeItem('refreshToken');
        storageRepository.removeItem('user');
        if (onUnauthorized) onUnauthorized();
        return Promise.reject(error);
      }

      try {
        const response = await axios.post<RefreshTokenResponse>(
          `${API_BASE_URL}/tms/api/auth/refresh`,
          { refreshToken },
          { headers: { 'Content-Type': 'application/json' } }
        );

        const { accessToken, refreshToken: newRefreshToken, user } = response.data;

        storageRepository.setItem('token', accessToken);
        storageRepository.setItem('refreshToken', newRefreshToken);
        storageRepository.setItem('user', JSON.stringify(user));

        processQueue(null, accessToken);

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return client(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        storageRepository.removeItem('token');
        storageRepository.removeItem('refreshToken');
        storageRepository.removeItem('user');
        if (onUnauthorized) onUnauthorized();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
  );

  return client;
}
