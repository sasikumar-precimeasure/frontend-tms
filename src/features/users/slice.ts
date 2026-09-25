import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { User, Role, Permission } from '../../domain/entities/User';
import type { Dependencies } from '../../app/dependencies';

// The frontend's shared Role type (User.ts, used by User.role) is
// intentionally lean - {id, name, status} - since that's all the login
// response needs. This screen's GET /tms/api/roles additionally returns
// each role's full permission list (RoleDto on the backend), so it gets its
// own richer type here rather than widening the shared one.
export interface RoleWithPermissions extends Role {
  permissions: Permission[];
}

interface UsersState {
  users: User[];
  roles: RoleWithPermissions[];
  isLoaded: boolean;
}

const initialState: UsersState = {
  users: [],
  roles: [],
  isLoaded: false,
};

// Backend-only screen (Settings > Users) for the super-admin user/role
// management API - matches tms-backend's UserController/RoleController
// exactly (see infrastructure/web/controller/*.java). Every mutating call
// there is gated on the caller's own write permission for the "Users"/
// "Roles" menu, not a hardcoded role name - a 403 here means the logged-in
// account doesn't hold that permission, not that the request was malformed.

export const fetchUsersAndRolesAsync = createAsyncThunk<
  { users: User[]; roles: RoleWithPermissions[] },
  void,
  { extra: Dependencies }
>('users/fetchAll', async (_, { extra }) => {
  const client = extra.infrastructure.apiClient;
  const [usersRes, rolesRes] = await Promise.all([
    client.get<User[]>('/tms/api/users'),
    client.get<RoleWithPermissions[]>('/tms/api/roles'),
  ]);
  return { users: usersRes.data, roles: rolesRes.data };
});

export interface CreateUserRequest {
  userName: string;
  fullName: string;
  email: string;
  mobile: string;
  password: string;
  roleId: number | null;
}

export const createUserAsync = createAsyncThunk<User, CreateUserRequest, { extra: Dependencies }>(
  'users/create',
  async (request, { extra }) => {
    const response = await extra.infrastructure.apiClient.post<User>('/tms/api/users', request);
    return response.data;
  }
);

export interface UpdateUserRequest {
  id: number;
  fullName: string;
  email: string;
  mobile: string;
  roleId: number | null;
}

export const updateUserAsync = createAsyncThunk<User, UpdateUserRequest, { extra: Dependencies }>(
  'users/update',
  async ({ id, ...body }, { extra }) => {
    const response = await extra.infrastructure.apiClient.patch<User>(`/tms/api/users/${id}`, body);
    return response.data;
  }
);

export const setUserStatusAsync = createAsyncThunk<User, { id: number; enabled: boolean }, { extra: Dependencies }>(
  'users/setStatus',
  async ({ id, enabled }, { extra }) => {
    const response = await extra.infrastructure.apiClient.patch<User>(`/tms/api/users/${id}/status`, { enabled });
    return response.data;
  }
);

export const deleteUserAsync = createAsyncThunk<{ id: number }, { id: number }, { extra: Dependencies }>(
  'users/delete',
  async ({ id }, { extra }) => {
    await extra.infrastructure.apiClient.delete(`/tms/api/users/${id}`);
    return { id };
  }
);

export const createRoleAsync = createAsyncThunk<RoleWithPermissions, { name: string }, { extra: Dependencies }>(
  'users/createRole',
  async (request, { extra }) => {
    const response = await extra.infrastructure.apiClient.post<RoleWithPermissions>('/tms/api/roles', request);
    return response.data;
  }
);

export const setRolePermissionsAsync = createAsyncThunk<
  { roleId: number; permissions: Permission[] },
  { roleId: number; permissions: Permission[] },
  { extra: Dependencies }
>('users/setRolePermissions', async ({ roleId, permissions }, { extra }) => {
  await extra.infrastructure.apiClient.put(`/tms/api/roles/${roleId}/permissions`, { permissions });
  return { roleId, permissions };
});

export const deleteRoleAsync = createAsyncThunk<{ roleId: number }, { roleId: number }, { extra: Dependencies }>(
  'users/deleteRole',
  async ({ roleId }, { extra }) => {
    await extra.infrastructure.apiClient.delete(`/tms/api/roles/${roleId}`);
    return { roleId };
  }
);

const usersSlice = createSlice({
  name: 'users',
  initialState,
  extraReducers: (builder) => {
    builder
      .addCase(fetchUsersAndRolesAsync.fulfilled, (state, action) => {
        state.users = action.payload.users;
        state.roles = action.payload.roles;
        state.isLoaded = true;
      })
      .addCase(createUserAsync.fulfilled, (state, action) => {
        state.users.push(action.payload);
      })
      .addCase(updateUserAsync.fulfilled, (state, action) => {
        const index = state.users.findIndex((u) => u.id === action.payload.id);
        if (index >= 0) state.users[index] = action.payload;
      })
      .addCase(setUserStatusAsync.fulfilled, (state, action) => {
        const index = state.users.findIndex((u) => u.id === action.payload.id);
        if (index >= 0) state.users[index] = action.payload;
      })
      .addCase(createRoleAsync.fulfilled, (state, action) => {
        state.roles.push(action.payload);
      })
      .addCase(setRolePermissionsAsync.fulfilled, (state, action) => {
        const role = state.roles.find((r) => r.id === action.payload.roleId);
        if (role) role.permissions = action.payload.permissions;
      })
      .addCase(deleteUserAsync.fulfilled, (state, action) => {
        state.users = state.users.filter((u) => u.id !== action.payload.id);
      })
      .addCase(deleteRoleAsync.fulfilled, (state, action) => {
        state.roles = state.roles.filter((r) => r.id !== action.payload.roleId);
      });
  },
  reducers: {},
});

export default usersSlice.reducer;
