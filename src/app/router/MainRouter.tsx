import { Route, createBrowserRouter, createRoutesFromElements, Navigate } from 'react-router-dom';
import { LoginPage } from '../../features/auth/pages/LoginPage';
import { ProtectedRoute } from '../../shared/components/ProtectedRoute';
import { TmsAppLayout } from '../../shared/components/TmsAppLayout';
import DashboardPage from '../../features/dashboard/DashboardPage';
import SettingsPage from '../../features/connectionSettings/pages/SettingsPage';

const MainRouter = createBrowserRouter(
  createRoutesFromElements(
    <>
      {/* Public Routes */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Protected Routes - side menu shell (Dashboard / Settings) */}
      <Route
        element={
          <ProtectedRoute>
            <TmsAppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </>
  )
);

export default MainRouter;
