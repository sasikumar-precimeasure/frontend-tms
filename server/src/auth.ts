// Settings changes and commands to the hardware must come from a logged-in
// user with WRITE permission - the same rule the website and backend apply.
// The website forwards the user's login token; we ask the backend who that
// is (GET /tms/api/users/me) and cache the answer briefly so a burst of
// commands doesn't mean a backend call each.
import type { NextFunction, Request, Response } from 'express';
import { BACKEND_URL } from './env';
import { logger } from './logger';

interface Permission {
  menu: string;
  read: boolean;
  write: boolean;
}

interface CachedUser {
  userName: string;
  permissions: Permission[];
  expiresAt: number;
}

const CACHE_MS = 60_000;
const cache = new Map<string, CachedUser>();

class AuthError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function userFor(token: string): Promise<CachedUser> {
  const cached = cache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached;

  let response: globalThis.Response;
  try {
    response = await fetch(`${BACKEND_URL}/tms/api/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    throw new AuthError(503, `Cannot check your permissions - the backend is not reachable (${(error as Error).message})`);
  }
  if (response.status === 401 || response.status === 403) {
    cache.delete(token);
    throw new AuthError(401, 'Your login has expired - please log in again');
  }
  if (!response.ok) throw new AuthError(503, `Cannot check your permissions - backend answered HTTP ${response.status}`);

  const body = (await response.json()) as { data?: { userName?: string; permissions?: Permission[]; role?: { permissions?: Permission[] } } };
  const user: CachedUser = {
    userName: body.data?.userName ?? 'unknown',
    permissions: body.data?.permissions ?? body.data?.role?.permissions ?? [],
    expiresAt: Date.now() + CACHE_MS,
  };
  cache.set(token, user);
  if (cache.size > 200) {
    for (const [key, value] of cache) if (value.expiresAt <= Date.now()) cache.delete(key);
  }
  return user;
}

// Express middleware: the caller needs write permission on at least one of
// `menus` (resolved per request, e.g. from the body).
export function requireWrite(menus: (req: Request) => string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const allowed = menus(req);
    try {
      if (!token) throw new AuthError(401, 'Login required');
      const user = await userFor(token);
      if (!user.permissions.some((p) => p.write && allowed.includes(p.menu))) {
        logger.warn('auth', 'Change refused - no write permission', { user: user.userName, needs: allowed.join(' or '), path: req.path });
        throw new AuthError(403, `You don't have permission to change ${allowed.join(' / ')}`);
      }
      res.locals.userName = user.userName;
      next();
    } catch (error) {
      if (error instanceof AuthError) {
        res.status(error.status).json({ message: error.message, errorMessage: error.message });
        return;
      }
      next(error);
    }
  };
}
