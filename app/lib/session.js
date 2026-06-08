import {createCookieSessionStorage} from '@shopify/remix-oxygen';

/**
 * This is a custom session implementation for your Hydrogen storefront.
 * Feel free to customize it to your needs, add helper methods, or
 * temporary variables for your requirements.
 * @see https://remix.run/docs/en/main/utils/sessions
 * @see https://h2o.run/docs/hydrogen/sessions
 */
export class AppSession {
  #sessionStorage;
  #session;

  constructor(sessionStorage, session) {
    this.#sessionStorage = sessionStorage;
    this.#session = session;
  }

  static async init(request, secrets) {
    const storage = createCookieSessionStorage({
      cookie: {
        name: 'session',
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secrets,
        maxAge: 604800, // 7 days
      },
    });

    const session = await storage
      .getSession(request.headers.get('Cookie'))
      .catch(() => storage.getSession());

    return new AppSession(storage, session);
  }

  get has() {
    return this.#session.has;
  }

  get get() {
    return this.#session.get;
  }

  get flash() {
    return this.#session.flash;
  }

  get unset() {
    return this.#session.unset;
  }

  get set() {
    return this.#session.set;
  }

  destroy() {
    return this.#sessionStorage.destroySession(this.#session);
  }

  commit() {
    return this.#sessionStorage.commitSession(this.#session);
  }
}
