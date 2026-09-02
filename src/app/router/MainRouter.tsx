import { Route, createBrowserRouter, createRoutesFromElements, Navigate } from 'react-router-dom';
import { LoginPage } from '../../features/auth/pages/LoginPage';
import { ProtectedRoute } from '../../shared/components/ProtectedRoute';
import DashboardPage from '../../features/dashboard/DashboardPage';
import ModbusConnectionPage from '../../features/modbus/pages/ModbusConnectionPage';

const MainRouter = createBrowserRouter(
  createRoutesFromElements(
    <>
      {/* Public Routes */}
      <Route path="/" element={<Navigate to="/modbus" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/modbus" element={<ModbusConnectionPage />} />

      {/* Protected Routes */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
    </>
  )
);

export default MainRouter;
