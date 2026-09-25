import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { Skeleton } from 'primereact/skeleton';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import type { User } from '../../../domain/entities/User';
import type { RoleWithPermissions } from '../slice';
import { fetchUsersAndRolesAsync, setUserStatusAsync, deleteUserAsync, deleteRoleAsync } from '../slice';
import { showToast } from '../../toast/slice';
import { useHasMenuPermission } from '../../../shared/hooks/usePermissions';
import { ADMIN_UI } from '../../../shared/theme/adminUiStyles';

type Tab = 'Roles' | 'Users';

const SearchIcon = (
  <svg
    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    viewBox="0 0 24 24"
  >
    <circle cx="11" cy="11" r="8" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
  </svg>
);

// Same pill-with-icon-in-circle badge assetmanagement uses for status
// columns (MembersPage.tsx's statusBodyTemplate) - visually distinct from
// tms's own previous dot-indicator badge, adopted here for design parity.
function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 min-w-[100px] px-3 py-1 rounded-full text-sm font-medium ${
        active ? 'bg-status-good-soft text-status-good' : 'bg-status-critical-soft text-status-critical'
      }`}
    >
      <span
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-xs ${
          active ? 'bg-status-good' : 'bg-status-critical'
        }`}
      >
        <i className={`pi ${active ? 'pi-check' : 'pi-times'}`} style={{ fontSize: '10px' }} />
      </span>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

const PAGE_SIZE = 10;

// Members (Settings > Users & Roles) - a single tabbed page mirroring the
// sibling asset-management app's own Members screen exactly (same tab bar,
// search bar, DataTable/badge/edit-icon look, bottom pagination+Add-button
// row), while keeping every one of tms's own data fields as they already
// were - only the visual layer changed. Users and Roles fetch together (see
// fetchUsersAndRolesAsync) and are paginated/filtered client-side here,
// since tms's own dataset is small and already fully loaded, unlike
// asset-management's server-paginated equivalent.
const MembersPage = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canReadUsers = useHasMenuPermission('Users');
  const canReadRoles = useHasMenuPermission('Roles');

  const users = useAppSelector((state) => state.users.users);
  const roles = useAppSelector((state) => state.users.roles);
  const isLoaded = useAppSelector((state) => state.users.isLoaded);

  const requestedTab = searchParams.get('tab');
  const initialTab: Tab = requestedTab === 'Users' && canReadUsers ? 'Users' : canReadRoles ? 'Roles' : 'Users';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchUsersAndRolesAsync())
      .unwrap()
      .catch(() => setLoadError('Could not load members - is the backend reachable, and do you have permission?'));
  }, [dispatch]);

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
    setSearchTerm('');
    setPage(1);
    setRowError(null);
  };

  const userCountByRoleId = useMemo(() => {
    const counts = new Map<number, number>();
    users.forEach((user) => {
      if (user.roleId !== null) counts.set(user.roleId, (counts.get(user.roleId) ?? 0) + 1);
    });
    return counts;
  }, [users]);

  const filteredRoles = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return query === '' ? roles : roles.filter((r) => r.name.toLowerCase().includes(query));
  }, [roles, searchTerm]);

  const filteredUsers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (query === '') return users;
    return users.filter(
      (u) =>
        u.userName.toLowerCase().includes(query) ||
        (u.fullName ?? '').toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query) ||
        (u.role?.name ?? '').toLowerCase().includes(query)
    );
  }, [users, searchTerm]);

  const totalPages = (count: number) => Math.max(1, Math.ceil(count / PAGE_SIZE));
  const pageSlice = <T,>(list: T[]) => list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const currentTotalPages = activeTab === 'Roles' ? totalPages(filteredRoles.length) : totalPages(filteredUsers.length);
  const pagedRoles = pageSlice(filteredRoles);
  const pagedUsers = pageSlice(filteredUsers);

  const handleDeleteRole = async (role: RoleWithPermissions) => {
    setRowError(null);
    try {
      await dispatch(deleteRoleAsync({ roleId: role.id })).unwrap();
      dispatch(showToast('Role deleted successfully'));
    } catch {
      const count = userCountByRoleId.get(role.id) ?? 0;
      setRowError(`Cannot delete "${role.name}" - still assigned to ${count} user(s), or you lack permission.`);
    }
  };

  const handleDeleteUser = async (user: User) => {
    setRowError(null);
    try {
      await dispatch(deleteUserAsync({ id: user.id })).unwrap();
      dispatch(showToast('User deleted successfully'));
    } catch {
      setRowError(`Cannot delete "${user.userName}" - you may not be able to delete your own account, or lack permission.`);
    }
  };

  const handleToggleUserStatus = async (user: User) => {
    setRowError(null);
    try {
      await dispatch(setUserStatusAsync({ id: user.id, enabled: !user.status })).unwrap();
      dispatch(showToast(user.status ? 'User deactivated successfully' : 'User activated successfully'));
    } catch {
      setRowError('Failed to update status - is the backend reachable, and do you have permission?');
    }
  };

  const skeletonRows = Array.from({ length: 5 }, (_, i) => ({ id: i }));
  const skeletonBody = () => <Skeleton width="80%" height="1.2rem" />;

  return (
    <div className={ADMIN_UI.LISTVIEW.BODY_BACKGROUND}>
      <div className="flex-1 flex flex-col min-h-0 w-full">
        <div className="flex mb-2">
          <h1 className={ADMIN_UI.LISTVIEW.PAGE_TITLE} style={{ fontSize: ADMIN_UI.LISTVIEW.PAGE_TITLE_SIZE }}>
            Members
          </h1>
        </div>

        <div className="flex mb-3">
          {canReadRoles && (
            <button
              onClick={() => switchTab('Roles')}
              className={`flex-1 py-2 text-base font-semibold transition ${
                activeTab === 'Roles' ? 'bg-(--primary-color) text-white' : 'bg-surface-200 text-surface-700 hover:bg-surface-300'
              }`}
            >
              Roles &amp; Permissions
            </button>
          )}
          {canReadUsers && (
            <button
              onClick={() => switchTab('Users')}
              className={`flex-1 py-2 text-base font-semibold transition ${
                activeTab === 'Users' ? 'bg-(--primary-color) text-white' : 'bg-surface-200 text-surface-700 hover:bg-surface-300'
              }`}
            >
              Users
            </button>
          )}
        </div>

        {loadError && (
          <div className="px-4 py-2.5 mb-3 rounded-lg bg-status-critical-soft text-status-critical text-sm font-medium">{loadError}</div>
        )}
        {rowError && (
          <div className="px-4 py-2.5 mb-3 rounded-lg bg-status-critical-soft text-status-critical text-sm font-medium">{rowError}</div>
        )}

        <div className="flex my-5">
          <div className="flex items-center gap-2">
            <h1 className={ADMIN_UI.LISTVIEW.SEARCH_FIELD_LABEL}>Search:</h1>
            <div className="relative">
              {SearchIcon}
              <InputText
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPage(1);
                }}
                className={ADMIN_UI.LISTVIEW.SEARCH_FIELD}
              />
            </div>
          </div>
        </div>

        {activeTab === 'Roles' && canReadRoles && (
          <div className="flex-1 min-h-0 rounded-lg shadow overflow-x-hidden overflow-y-auto">
            {!isLoaded ? (
              <DataTable value={skeletonRows} className="w-full" rowClassName={() => ADMIN_UI.LISTVIEW.DATATABLE_BODY}>
                <Column header="Role Name" body={skeletonBody} headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER} />
                <Column header="Users" body={skeletonBody} headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER} />
                <Column header="Permissions" body={skeletonBody} headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER} />
                <Column header="Edit" body={skeletonBody} headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER} />
              </DataTable>
            ) : (
              <DataTable
                value={pagedRoles}
                className="w-full"
                rowClassName={() => ADMIN_UI.LISTVIEW.DATATABLE_BODY}
                emptyMessage={
                  <div className={ADMIN_UI.LISTVIEW.DATATABLE_NO_DATA}>
                    {roles.length === 0 ? 'No roles yet.' : 'No roles match your search.'}
                  </div>
                }
              >
                <Column
                  field="name"
                  header="Role Name"
                  headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER}
                  headerStyle={{ paddingLeft: '4rem' }}
                  bodyStyle={{ padding: '0.25rem 4rem' }}
                />
                <Column
                  header="Users"
                  body={(role: RoleWithPermissions) => `${userCountByRoleId.get(role.id) ?? 0} user(s)`}
                  headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER}
                  headerStyle={{ paddingLeft: '4rem' }}
                  bodyStyle={{ padding: '0.25rem 4rem' }}
                />
                <Column
                  header="Permissions"
                  body={(role: RoleWithPermissions) => {
                    const withAccess = role.permissions.filter((p) => p.read || p.write);
                    const fullAccess = role.permissions.filter((p) => p.read && p.write).length;
                    if (withAccess.length === 0) return 'No permissions';
                    if (fullAccess === role.permissions.length && role.permissions.length > 0) return 'Full access';
                    return `${withAccess.length} of ${role.permissions.length} menus`;
                  }}
                  headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER}
                  bodyStyle={{ padding: '0.25rem 1.5rem' }}
                />
                <Column
                  header="Edit"
                  body={(role: RoleWithPermissions) => (
                    <div className="flex items-center gap-1">
                      <Button
                        icon="pi pi-pencil"
                        className="border-0 bg-transparent p-2 text-surface-600 hover:text-primary"
                        text
                        rounded
                        onClick={() => navigate(`/members/roles/${role.id}/edit`)}
                      />
                      <Button
                        icon="pi pi-trash"
                        className="border-0 bg-transparent p-2 text-surface-600 hover:text-status-critical"
                        text
                        rounded
                        onClick={() => handleDeleteRole(role)}
                      />
                    </div>
                  )}
                  headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER}
                  headerStyle={{ paddingLeft: '1.5rem' }}
                  bodyStyle={{ padding: '0.25rem 1rem' }}
                />
              </DataTable>
            )}
          </div>
        )}

        {activeTab === 'Users' && canReadUsers && (
          <div className="flex-1 min-h-0 rounded-lg shadow overflow-x-hidden overflow-y-auto">
            {!isLoaded ? (
              <DataTable value={skeletonRows} className="w-full" rowClassName={() => ADMIN_UI.LISTVIEW.DATATABLE_BODY}>
                <Column header="User" body={skeletonBody} headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER} />
                <Column header="Email" body={skeletonBody} headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER} />
                <Column header="Mobile" body={skeletonBody} headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER} />
                <Column header="Role" body={skeletonBody} headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER} />
                <Column header="Status" body={skeletonBody} headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER} />
                <Column header="Edit" body={skeletonBody} headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER} />
              </DataTable>
            ) : (
              <DataTable
                value={pagedUsers}
                className="w-full"
                rowClassName={() => ADMIN_UI.LISTVIEW.DATATABLE_BODY}
                emptyMessage={
                  <div className={ADMIN_UI.LISTVIEW.DATATABLE_NO_DATA}>
                    {users.length === 0 ? 'No users yet.' : 'No users match your search.'}
                  </div>
                }
              >
                <Column
                  header="User"
                  headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER}
                  headerStyle={{ paddingLeft: '3.5rem' }}
                  bodyStyle={{ padding: '0.25rem 4rem' }}
                  body={(user: User) => (
                    <div>
                      <p className="font-medium">{user.fullName || user.userName}</p>
                      <p className="text-xs text-surface-500">@{user.userName}</p>
                    </div>
                  )}
                />
                <Column field="email" header="Email" headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER} bodyStyle={{ padding: '0.25rem 1.5rem' }} />
                <Column
                  header="Mobile"
                  body={(user: User) => user.mobile ?? '—'}
                  headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER}
                  bodyStyle={{ padding: '0.25rem 1.5rem' }}
                />
                <Column
                  header="Role"
                  body={(user: User) => user.role?.name ?? 'No role'}
                  headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER}
                  bodyStyle={{ padding: '0.25rem 1.5rem' }}
                />
                <Column
                  header="Status"
                  body={(user: User) => <StatusBadge active={user.status} />}
                  headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER}
                  headerStyle={{ paddingLeft: '2.5rem' }}
                  bodyStyle={{ padding: '0.25rem 1.5rem' }}
                />
                <Column
                  header="Edit"
                  body={(user: User) => (
                    <div className="flex items-center gap-1">
                      <Button
                        icon="pi pi-pencil"
                        className="border-0 bg-transparent p-2 text-surface-600 hover:text-primary"
                        text
                        rounded
                        onClick={() => navigate(`/members/users/${user.id}/edit`)}
                      />
                      <Button
                        icon={user.status ? 'pi pi-ban' : 'pi pi-check-circle'}
                        className="border-0 bg-transparent p-2 text-surface-600 hover:text-status-warn"
                        text
                        rounded
                        disabled={user.role?.name === 'Super Admin'}
                        title={user.role?.name === 'Super Admin' ? 'The Super Admin account cannot be deactivated' : undefined}
                        onClick={() => handleToggleUserStatus(user)}
                      />
                      <Button
                        icon="pi pi-trash"
                        className="border-0 bg-transparent p-2 text-surface-600 hover:text-status-critical"
                        text
                        rounded
                        onClick={() => handleDeleteUser(user)}
                      />
                    </div>
                  )}
                  headerClassName={ADMIN_UI.LISTVIEW.DATATABLE_HEADER}
                  headerStyle={{ paddingLeft: '2.5rem' }}
                  bodyStyle={{ padding: '0.25rem 2rem' }}
                />
              </DataTable>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mt-6 pb-8">
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-surface-900">{`Page ${page} of ${currentTotalPages}`}</span>
            {currentTotalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button icon="pi pi-chevron-left" text disabled={page <= 1} onClick={() => setPage((p) => p - 1)} />
                <Button
                  icon="pi pi-chevron-right"
                  text
                  disabled={page >= currentTotalPages}
                  onClick={() => setPage((p) => p + 1)}
                />
              </div>
            )}
          </div>

          <Button
            label={activeTab === 'Roles' ? 'Add Role' : 'Add User'}
            onClick={() => navigate(activeTab === 'Roles' ? '/members/roles/new' : '/members/users/new')}
            icon="pi pi-plus"
            pt={{ icon: { className: 'mr-2.5' } }}
            className="bg-(--primary-color) hover:bg-(--primary-color) text-white px-8 py-3 rounded-lg font-semibold transition"
            outlined
          />
        </div>
      </div>
    </div>
  );
};

export default MembersPage;
