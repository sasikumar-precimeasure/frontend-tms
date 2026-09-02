import { RouterProvider } from 'react-router-dom';
import MainRouter from './app/router/MainRouter';

function App() {
  return <RouterProvider router={MainRouter} />;
}

export default App;
