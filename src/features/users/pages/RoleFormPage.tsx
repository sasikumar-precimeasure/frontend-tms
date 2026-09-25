import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import { fetchUsersAndRolesAsync, createRoleAsync, setRolePermissionsAsync } from '../slice';
import { recordAuditEventAsync } from '../../auditLog/slice';
import { showToast } from '../../toast/slice';
import { ConfirmSaveDialog } from '../../../shared/components/ConfirmSaveDialog';
import { ADMIN_UI } from '../../../shared/theme/adminUiStyles';

// Every menu a role's permissions can be scoped to - mirrors the seed list
// in tms-backend's V1__init.sql exactly (Dashboard, Connection Settings,
// AVR Settings, Mail Configuration, Users, Roles, Audit Log). A role is
// "super admin" only in the sense that all of these are checked - there's
// no separate flag anywhere in this model.
const PERMISSION_MENUS = [
  'Dashboard',
  'Connection Settings',
  'AVR Settings',
  'Mail Configuration',
  'Users',
  'Roles',
  'Audit Log',
] as const;

interface PermissionState {
  read: boolean;
  write: boolean;
}

function emptyPermissions(): Record<string, PermissionState> {
  return Object.fromEntries(PERMISSION_MENUS.map((menu) => [menu, { read: false, write: false }]));
}

// /roles/new (create) and /roles/:id/edit (edit permissions) share this one
// page - a new role starts with every permission unchecked and is created
// immediately on save (name + permissions together), an existing role's
// permissions are loaded and saved via setRolePermissionsAsync.
const RoleFormPage = () => {
  const { id } = useParams<{ id: string }>();
  const isEditing = id !== undefined;
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const isLoaded = useAppSelector((state) => state.users.isLoaded);
  const existingRole = useAppSelector((state) => (isEditing ? state.users.roles.find((r) => r.id === Number(id)) : undefined));

  const [roleName, setRoleName] = useState('');
  const [permissions, setPermissions] = useState<Record<string, PermissionState>>(emptyPermissions());
  const [hydrated, setHydrated] = useState(!isEditing);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingSave, setConfirmingSave] = useState(false);

  useEffect(() => {
    if (!isLoaded) {
      dispatch(fetchUsersAndRolesAsync());
    }
  }, [dispatch, isLoaded]);

  // Hydrate once from the fetched role. Checked directly against `hydrated`
  // (not a previous-value comparison) since existingRole can already be
  // populated on this component's very first render - e.g. navigating here
  // from the Roles table, which already fetched the list - and a
  // prevValue-seeded-from-initial-state comparison would never see that as
  // a "change" and would leave the form empty.
  if (existingRole && !hydrated) {
    setRoleName(existingRole.name);
    const next = emptyPermissions();
    existingRole.permissions.forEach((p) => {
      if (next[p.menu]) next[p.menu] = { read: p.read, write: p.write };
    });
    setPermissions(next);
    setHydrated(true);
  }

  const togglePermission = (menu: string, field: 'read' | 'write') => {
    setPermissions((prev) => ({ ...prev, [menu]: { ...prev[menu], [field]: !prev[menu][field] } }));
  };

  const setAll = (read: boolean, write: boolean) => {
    setPermissions(Object.fromEntries(PERMISSION_MENUS.map((menu) => [menu, { read, write }])));
  };

  const permissionsAsList = () =>
    PERMISSION_MENUS.map((menu) => ({
      menu,
      function: 'manage',
      read: permissions[menu].read,
      write: permissions[menu].write,
    }));

  const performSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (isEditing && existingRole) {
        await dispatch(setRolePermissionsAsync({ roleId: existingRole.id, permissions: permissionsAsList() })).unwrap();
        dispatch(recordAuditEventAsync({ eventType: 'USER_UPDATED', description: `Updated permissions for role ${existingRole.name}` }));
        dispatch(showToast('Role updated successfully'));
      } else {
        const created = await dispatch(createRoleAsync({ name: roleName })).unwrap();
        const hasAnyPermission = PERMISSION_MENUS.some((menu) => permissions[menu].read || permissions[menu].write);
        if (hasAnyPermission) {
          await dispatch(setRolePermissionsAsync({ roleId: created.id, permissions: permissionsAsList() })).unwrap();
        }
        dispatch(showToast('Role added successfully'));
      }
      navigate('/members?tab=Roles');
    } catch {
      setError('Save failed - is the backend reachable, and do you have permission?');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = () => {
    if (!isEditing && roleName.trim() === '') {
      setNameError('Role name is required');
      return;
    }
    setNameError(null);
    if (isEditing) {
      setConfirmingSave(true);
      return;
    }
    performSave();
  };

  if (isEditing && isLoaded && !existingRole) {
    return (
      <div className={ADMIN_UI.DETAILVIEW.BODY_BACKGROUND}>
        <div className="max-w-6xl mx-auto">
          <button
            className="flex items-center gap-2 mb-6 text-surface-600 hover:text-surface-900 transition"
            onClick={() => navigate('/members?tab=Roles')}
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <h1 className={ADMIN_UI.DETAILVIEW.PAGE_TITLE}>Role not found</h1>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={ADMIN_UI.DETAILVIEW.BODY_BACKGROUND}>
      <div className="max-w-6xl mx-auto">
        <button
          className="flex items-center gap-2 mb-6 text-surface-600 hover:text-surface-900 transition"
          onClick={() => navigate('/members?tab=Roles')}
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <h1 className={ADMIN_UI.DETAILVIEW.PAGE_TITLE}>{isEditing ? 'Edit Role' : 'Add Role'}</h1>
        </button>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-20 mb-6">
          <div>
            <label className={ADMIN_UI.DETAILVIEW.FIELD_TITLE} style={{ fontSize: ADMIN_UI.DETAILVIEW.FIELD_TEXT_SIZE }}>
              Role Name {!isEditing && <span className="text-red-500">*</span>}
            </label>
            {isEditing ? (
              <p className="text-base font-medium text-surface-900 py-3">{roleName}</p>
            ) : (
              <input
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                placeholder="Enter role name, e.g. Operator"
                className={ADMIN_UI.DETAILVIEW.FIELD_TEXT_INPUT}
                style={{ fontSize: ADMIN_UI.DETAILVIEW.FIELD_TEXT_SIZE }}
              />
            )}
            {nameError && <p className="text-red-500 text-sm">{nameError}</p>}
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <h2 className={ADMIN_UI.DETAILVIEW.FIELD_SUB_TITLE} style={{ fontSize: ADMIN_UI.DETAILVIEW.FIELD_SUB_TITLE_SIZE }}>
            Permissions
          </h2>
          <div className="flex items-center gap-3">
            <button onClick={() => setAll(true, true)} className="text-sm font-semibold text-(--primary-color) hover:opacity-80">
              Grant all
            </button>
            <button onClick={() => setAll(false, false)} className="text-sm font-semibold text-surface-500 hover:text-surface-700">
              Clear all
            </button>
          </div>
        </div>

        <div className={`${ADMIN_UI.DETAILVIEW.ROLES_PERMISSION} mb-6`}>
          <div className={ADMIN_UI.DETAILVIEW.ROLES_HEADER_ROW}>
            <div>Menu</div>
            <div className="text-center">Read</div>
            <div className="text-center">Write</div>
          </div>
          {PERMISSION_MENUS.map((menu) => {
            const permission = permissions[menu];
            return (
              <div key={menu} className={ADMIN_UI.DETAILVIEW.ROLES_SECTION_ITEM}>
                <div className="text-surface-900 font-medium">{menu}</div>
                <div className="text-center">
                  <input
                    type="checkbox"
                    checked={permission.read}
                    onChange={() => togglePermission(menu, 'read')}
                    className="w-5 h-5"
                  />
                </div>
                <div className="text-center">
                  <input
                    type="checkbox"
                    checked={permission.write}
                    onChange={() => togglePermission(menu, 'write')}
                    className="w-5 h-5"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {error && <div className="mb-4 px-3 py-2 rounded-md bg-status-critical-soft text-status-critical text-sm font-medium">{error}</div>}

        <div className="flex justify-start">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || (isEditing && !hydrated)}
            className="bg-(--primary-color) hover:bg-(--primary-color) text-white px-8 py-3 rounded-lg font-semibold transition flex items-center gap-2 disabled:opacity-50"
          >
            {saving && <i className="pi pi-spin pi-spinner" style={{ fontSize: '1rem' }} />}
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>

      <ConfirmSaveDialog
        visible={confirmingSave}
        onConfirm={() => {
          setConfirmingSave(false);
          performSave();
        }}
        onCancel={() => setConfirmingSave(false)}
      />
    </div>
  );
};

export default RoleFormPage;
