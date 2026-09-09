import { Route, createBrowserRouter, createRoutesFromElements, Navigate } from 'react-router-dom';
import { LoginPage } from '../../features/auth/pages/LoginPage';
import { TmsAppLayout } from '../../shared/components/TmsAppLayout';
import DashboardPage from '../../features/dashboard/DashboardPage';
import SettingsPage from '../../features/connectionSettings/pages/SettingsPage';

const MainRouter = createBrowserRouter(
  createRoutesFromElements(
    <>
      {/* Public Routes */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Side menu shell (Dashboard / Settings) - auth guard disabled for now,
          no backend to authenticate against yet. */}
      <Route element={<TmsAppLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </>
  )
);

export default MainRouter;
