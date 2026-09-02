import { useAppDispatch, useAppSelector } from '../../app/store/hooks';
import { logoutAsync } from '../auth/slice';
import { Button } from '../../shared/components';

const DashboardPage = () => {
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((state) => state.auth);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50">
      <h1 className="text-2xl font-bold text-gray-800">Welcome{user?.fullName ? `, ${user.fullName}` : ''}</h1>
      <p className="text-gray-600">Temperature Monitoring System dashboard placeholder.</p>
      <Button variant="outline" onClick={() => dispatch(logoutAsync())}>
        Logout
      </Button>
    </div>
  );
};

export default DashboardPage;
