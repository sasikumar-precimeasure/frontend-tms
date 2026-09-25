import { RouterProvider } from 'react-router-dom';
import MainRouter from './app/router/MainRouter';
import { ToastContainer } from './shared/components/ToastContainer';
import { NotificationBanner } from './shared/components/NotificationBanner';

function App() {
  return (
    <>
      <RouterProvider router={MainRouter} />
      <ToastContainer />
      <NotificationBanner />
    </>
  );
}

export default App;
