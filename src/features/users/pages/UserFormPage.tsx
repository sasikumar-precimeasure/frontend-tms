import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import { fetchUsersAndRolesAsync, createUserAsync, updateUserAsync } from '../slice';
import { showToast } from '../../toast/slice';
import { ConfirmSaveDialog } from '../../../shared/components/ConfirmSaveDialog';
import { ADMIN_UI } from '../../../shared/theme/adminUiStyles';

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

interface FormValues {
  userName: string;
  fullName: string;
  email: string;
  mobile: string;
  password: string;
  roleId: number | null;
}

const EMPTY_FORM: FormValues = { userName: '', fullName: '', email: '', mobile: '', password: '', roleId: null };

// Field wrapper matching assetmanagement's AddUsersPage/AddRolesPage text
// field pattern exactly (theme.FIELD_TITLE_INPUT label + theme.FIELD_TEXT_INPUT
// input, red asterisk for required, red error text below).
function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={ADMIN_UI.DETAILVIEW.FIELD_TITLE} style={{ fontSize: ADMIN_UI.DETAILVIEW.FIELD_TEXT_SIZE }}>
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </div>
  );
}

function TextField(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={ADMIN_UI.DETAILVIEW.FIELD_TEXT_INPUT} style={{ fontSize: ADMIN_UI.DETAILVIEW.FIELD_TEXT_SIZE }} />;
}

// /users/new (create) and /users/:id/edit (update) share this one page -
// userName and password are only collected on create (the backend has no
// change-username/change-own-password-via-this-screen endpoints; a real
// admin resets a forgotten password via the existing forgot-password flow).
const UserFormPage = () => {
  const { id } = useParams<{ id: string }>();
  const isEditing = id !== undefined;
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const roles = useAppSelector((state) => state.users.roles);
  const isLoaded = useAppSelector((state) => state.users.isLoaded);
  const existingUser = useAppSelector((state) => (isEditing ? state.users.users.find((u) => u.id === Number(id)) : undefined));

  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [hydrated, setHydrated] = useState(!isEditing);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [saving, setSaving] = useState(false);
  const [confirmingSave, setConfirmingSave] = useState(false);

  useEffect(() => {
    if (!isLoaded) {
      dispatch(fetchUsersAndRolesAsync());
    }
  }, [dispatch, isLoaded]);

  // Hydrate the form from the fetched user exactly once. Checked directly
  // against `hydrated` (not a previous-value comparison) since existingUser
  // can already be populated on this component's very first render - e.g.
  // navigating here from the Users table, which already fetched the list -
  // and a prevValue-seeded-from-initial-state comparison would never see
  // that as a "change" and would leave the form empty.
  if (existingUser && !hydrated) {
    setValues({
      userName: existingUser.userName,
      fullName: existingUser.fullName ?? '',
      email: existingUser.email,
      mobile: existingUser.mobile ?? '',
      password: '',
      roleId: existingUser.roleId,
    });
    setHydrated(true);
  }

  const validate = (): boolean => {
    const nextErrors: Partial<Record<keyof FormValues, string>> = {};
    if (!isEditing && values.userName.trim() === '') nextErrors.userName = 'Username is required';
    if (!isValidEmail(values.email)) nextErrors.email = 'Please enter a valid email';
    if (!isEditing && values.password.trim().length < 6) nextErrors.password = 'Password must be at least 6 characters';
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const performSave = async () => {
    setError(null);
    setSaving(true);
    try {
      // Both updateUser and createUser already write their own audit row
      // server-side (ManageUsersUseCase), with the true actor id from the
      // JWT - recording one here too would double every entry in the log.
      if (isEditing && existingUser) {
        await dispatch(
          updateUserAsync({
            id: existingUser.id,
            fullName: values.fullName,
            email: values.email,
            mobile: values.mobile,
            roleId: values.roleId,
          })
        ).unwrap();
        dispatch(showToast('User updated successfully'));
      } else {
        await dispatch(
          createUserAsync({
            userName: values.userName,
            fullName: values.fullName,
            email: values.email,
            mobile: values.mobile,
            password: values.password,
            roleId: values.roleId,
          })
        ).unwrap();
        dispatch(showToast('User added successfully'));
      }
      navigate('/members?tab=Users');
    } catch {
      setError('Save failed - is the backend reachable, and do you have permission?');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = () => {
    if (!validate()) return;
    if (isEditing) {
      setConfirmingSave(true);
      return;
    }
    performSave();
  };

  if (isEditing && isLoaded && !existingUser) {
    return (
      <div className={ADMIN_UI.DETAILVIEW.BODY_BACKGROUND}>
        <div className="max-w-6xl mx-auto">
          <button
            className="flex items-center gap-2 mb-6 text-surface-600 hover:text-surface-900 transition"
            onClick={() => navigate('/members?tab=Users')}
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <h1 className={ADMIN_UI.DETAILVIEW.PAGE_TITLE}>User not found</h1>
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
          onClick={() => navigate('/members?tab=Users')}
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <h1 className={ADMIN_UI.DETAILVIEW.PAGE_TITLE}>{isEditing ? 'Edit User' : 'Add User'}</h1>
        </button>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-20 mb-6">
          {!isEditing && (
            <Field label="Username" required error={fieldErrors.userName}>
              <TextField
                value={values.userName}
                onChange={(e) => setValues({ ...values, userName: e.target.value })}
                placeholder="Enter username"
              />
            </Field>
          )}
          <Field label="Full Name">
            <TextField
              value={values.fullName}
              onChange={(e) => setValues({ ...values, fullName: e.target.value })}
              placeholder="Enter full name"
            />
          </Field>
          {!isEditing && (
            <Field label="Password" required error={fieldErrors.password}>
              <TextField
                type="password"
                value={values.password}
                onChange={(e) => setValues({ ...values, password: e.target.value })}
                placeholder="At least 6 characters"
              />
            </Field>
          )}
          <Field label="Email" required error={fieldErrors.email}>
            <TextField
              type="email"
              value={values.email}
              onChange={(e) => setValues({ ...values, email: e.target.value })}
              placeholder="Enter email address"
            />
          </Field>
          <Field label="Mobile">
            <TextField
              value={values.mobile}
              onChange={(e) => setValues({ ...values, mobile: e.target.value })}
              placeholder="Optional"
            />
          </Field>
          <Field label="Role">
            <select
              value={values.roleId ?? ''}
              onChange={(e) => setValues({ ...values, roleId: e.target.value === '' ? null : Number(e.target.value) })}
              className={ADMIN_UI.DETAILVIEW.FIELD_TEXT_INPUT}
              style={{ fontSize: ADMIN_UI.DETAILVIEW.FIELD_TEXT_SIZE }}
            >
              <option value="">No role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </Field>
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

export default UserFormPage;
