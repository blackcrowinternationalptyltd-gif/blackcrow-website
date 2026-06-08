import {createCookieSessionStorage} from '@shopify/remix-oxygen';

/**
 * Standalone session storage — works in vite dev (Node.js), shopify hydrogen
 * preview (MiniOxygen), and production Shopify Oxygen (Cloudflare Workers).
 * process.env.SESSION_SECRET is available in all three environments.
 */
const isProd = process.env.NODE_ENV === 'production';

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: 'bc_session',
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: isProd, // HTTPS-only in production, allows HTTP in local dev
    secrets: [process.env.SESSION_SECRET ?? 'dev-secret-fallback'],
    maxAge: 604800, // 7 days
  },
});

export function getSession(request) {
  return sessionStorage.getSession(request.headers.get('Cookie'));
}

export function commitSession(session) {
  return sessionStorage.commitSession(session);
}

export function destroySession(session) {
  return sessionStorage.destroySession(session);
}
