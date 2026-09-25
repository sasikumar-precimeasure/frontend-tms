import { Route, createBrowserRouter, createRoutesFromElements, Navigate } from 'react-router-dom';
import { LoginPage } from '../../features/auth/pages/LoginPage';
import { TmsAppLayout } from '../../shared/components/TmsAppLayout';
import { RequirePermission } from '../../shared/components/RequirePermission';
import DashboardPage from '../../features/dashboard/DashboardPage';
import SettingsPage from '../../features/connectionSettings/pages/SettingsPage';
import MembersPage from '../../features/users/pages/MembersPage';
import UserFormPage from '../../features/users/pages/UserFormPage';
import RoleFormPage from '../../features/users/pages/RoleFormPage';
import AuditLogPage from '../../features/auditLog/pages/AuditLogPage';

const MainRouter = createBrowserRouter(
  createRoutesFromElements(
    <>
      {/* Public Routes */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Side menu shell (Dashboard / Settings / Members / Audit Log) - each
          admin section is wrapped in RequirePermission so a typed-in or
          bookmarked URL can't reach a screen the user's role can't read,
          even though TmsAppLayout already hides the nav link for it. Users
          and Roles share one "Members" page (see MembersPage) with tabs,
          each tab independently gated on its own menu permission - so
          /members itself is reachable with either Users or Roles read
          access, matching MembersPage's own tab-visibility logic. */}
      <Route element={<TmsAppLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route
          path="/settings"
          element={
            <RequirePermission menu={['Connection Settings', 'AVR Settings', 'Mail Configuration']}>
              <SettingsPage />
            </RequirePermission>
          }
        />
        <Route
          path="/members"
          element={
            <RequirePermission menu={['Users', 'Roles']}>
              <MembersPage />
            </RequirePermission>
          }
        />
        <Route
          path="/members/users/new"
          element={
            <RequirePermission menu="Users">
              <UserFormPage />
            </RequirePermission>
          }
        />
        <Route
          path="/members/users/:id/edit"
          element={
            <RequirePermission menu="Users">
              <UserFormPage />
            </RequirePermission>
          }
        />
        <Route
          path="/members/roles/new"
          element={
            <RequirePermission menu="Roles">
              <RoleFormPage />
            </RequirePermission>
          }
        />
        <Route
          path="/members/roles/:id/edit"
          element={
            <RequirePermission menu="Roles">
              <RoleFormPage />
            </RequirePermission>
          }
        />
        <Route
          path="/audit-log"
          element={
            <RequirePermission menu="Audit Log">
              <AuditLogPage />
            </RequirePermission>
          }
        />
      </Route>
    </>
  )
);

export default MainRouter;
