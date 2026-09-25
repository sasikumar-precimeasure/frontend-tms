import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
// PrimeReact's own stylesheets, imported before tms's index.css so its
// Tailwind utilities still win the cascade where they overlap - matches
// assetmanagement's setup (same PrimeReact version, same lara-light-blue
// base theme) exactly, no PrimeReactProvider wrapper needed.
import 'primereact/resources/themes/lara-light-blue/theme.css';
import 'primereact/resources/primereact.min.css';
import 'primeicons/primeicons.css';
import './index.css';
import App from './App.tsx';
import { initializeDependencies, dependencies } from './app/dependencies';
import { createStore } from './app/store';
import { hydrateAuth, fetchCurrentUserAsync } from './features/auth/slice';

// Step 1: Initialize dependencies
initializeDependencies({
  onUnauthorized: () => {
    // Invoked when the API returns 401. We can't use React Router's navigate
    // here since we're outside the React tree, so a hard redirect is used.
    window.location.href = '/login';
  },
});

// Step 2: Create Redux store with dependencies
export const store = createStore({ dependencies });

// Step 3: Hydrate auth state from storage so refreshes keep the session
const token = dependencies.infrastructure.storageRepository.getItem('token');
const user = dependencies.infrastructure.storageRepository.getItem('user');
store.dispatch(hydrateAuth({ token, user }));

if (token) {
  store.dispatch(fetchCurrentUserAsync());
}

// Step 4: Render React app
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>
);
