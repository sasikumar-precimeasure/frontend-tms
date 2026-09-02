# Temperature Monitoring System (TMS)

Base setup for the TMS frontend, built with the same Clean Architecture pattern as `assetmanagement`:

- `src/domain` — entities, repository interfaces, use cases (framework-agnostic business rules)
- `src/infrastructure` — repository implementations, API client (axios + auth interceptors)
- `src/app/dependencies` — DI container with lazy-loaded feature dependencies
- `src/app/store` — Redux Toolkit store, typed hooks, dependencies injected as thunk `extra`
- `src/app/router` — React Router v7 (`createBrowserRouter`)
- `src/features/{name}` — feature slices, pages
- `src/shared/components` — reusable UI (Button, ProtectedRoute)

## Current scope

Base setup only: login page + auth slice + protected dashboard placeholder. Wired against
`/tms/api/auth/*` and `/tms/api/users/me` endpoints (update `.env.development` /
`.env.production` once the real API base URL is known).

## Getting started

```bash
npm install
npm run dev
```
