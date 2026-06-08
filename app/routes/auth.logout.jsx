import {redirect} from '@shopify/remix-oxygen';
import {getSession, destroySession} from '~/lib/session.server';

export async function action({request}) {
  const session = await getSession(request);
  return redirect('/login', {
    headers: {'Set-Cookie': await destroySession(session)},
  });
}

// GET requests just redirect to login
export async function loader() {
  return redirect('/login');
}
