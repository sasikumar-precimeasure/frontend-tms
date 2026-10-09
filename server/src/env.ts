// Where the TMS backend is, and the shared key for pushing readings to it.
export const BACKEND_URL = (process.env.TMS_BACKEND_URL ?? 'http://localhost:8080').replace(/\/$/, '');
export const INGEST_KEY = process.env.TMS_INGEST_KEY ?? 'CHANGE_ME_DEV_ONLY_ingest-key';

// The gateway service only accepts connections from this PC by default
// (the website calls it as http://localhost:4000). Set GATEWAY_HOST=0.0.0.0
// only if browsers on other PCs must reach it directly - changes still
// require a logged-in user with write permission either way (see auth.ts).
export const GATEWAY_HOST = process.env.GATEWAY_HOST ?? '127.0.0.1';
