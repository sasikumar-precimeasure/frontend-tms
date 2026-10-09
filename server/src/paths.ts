// The gateway's own folder (tms/server), wherever this file runs from: src/
// under tsx in dev, or dist/server/src/ after `npm run build` (the build
// includes the website's shared decoding files, so its output is nested).
import { join, resolve, sep } from 'path';

const builtMarker = `${sep}dist${sep}server${sep}src`;

export const SERVER_ROOT = __dirname.endsWith(builtMarker) ? resolve(__dirname, '..', '..', '..') : resolve(__dirname, '..');

export const DATA_DIR = process.env.DATA_DIR ?? join(SERVER_ROOT, 'data');
export const DEFAULT_LOG_DIR = join(SERVER_ROOT, 'logs');
