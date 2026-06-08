import {redirect} from '@shopify/remix-oxygen';
import {getSession} from '~/lib/session.server';

/**
 * Requires a logged-in admin user.
 * Reads session from the request cookie — works in vite dev and production.
 * Throws redirect to /login if no session exists.
 * Returns the user object from the session.
 */
export async function requireAdminUser(request) {
  const session = await getSession(request);
  const user = session.get('adminUser');
  if (!user) throw redirect('/login');
  return user;
}

/**
 * Requires Final Admin role.
 * Throws redirect to /login if no session.
 * Throws redirect to dashboard with ?access_denied=1 if role !== 'Final Admin'.
 * Returns the user object.
 */
export async function requireFinalAdmin(request) {
  const user = await requireAdminUser(request);
  if (user.role !== 'Final Admin') {
    throw redirect('/adminlogonprotocol?access_denied=1');
  }
  return user;
}

/**
 * Returns the country filter value for database queries.
 * Final Admin → null (no filter, see all countries)
 * Country Admin → first country in country_access array
 */
export function getCountryFilter(user) {
  if (user.role === 'Final Admin') return null;
  const ca = user.country_access;
  return Array.isArray(ca) && ca.length > 0 ? ca[0] : null;
}
