import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Fail instead of silently moving to 5174 when 5173 is taken - a second
  // website copy (with its own stale settings) would fight the first over
  // the same gateway connections. See scripts/port-guard.cjs.
  server: { port: 5173, strictPort: true },
});
