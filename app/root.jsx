import {useNonce, getShopAnalytics} from '@shopify/hydrogen';
import {defer, json} from '@shopify/remix-oxygen';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  isRouteErrorResponse,
  useLocation,
} from '@remix-run/react';
import appStyles from '~/styles/app.css?url';
import {Navbar} from '~/components/Navbar';
import {Footer} from '~/components/Footer';
import {CartProvider} from '~/context/CartContext';

export function links() {
  return [
    {rel: 'stylesheet', href: appStyles},
    {rel: 'preconnect', href: 'https://fonts.googleapis.com'},
    {
      rel: 'preconnect',
      href: 'https://fonts.gstatic.com',
      crossOrigin: 'anonymous',
    },
  ];
}

export async function loader({context}) {
  // Context is absent in plain `vite dev` mode (no Oxygen runtime).
  if (!context?.storefront) {
    return json({});
  }
  const {storefront, env} = context;
  return defer({
    shop: getShopAnalytics({
      storefront,
      publicStorefrontId: env.PUBLIC_STOREFRONT_ID,
    }),
    consent: {
      checkoutDomain: env.PUBLIC_CHECKOUT_DOMAIN,
      storefrontAccessToken: env.PUBLIC_STOREFRONT_API_TOKEN,
    },
  });
}

export default function App() {
  const nonce = useNonce();
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/adminlogonprotocol') ||
                  location.pathname.startsWith('/invoice/') ||
                  location.pathname.startsWith('/auth/') ||
                  location.pathname === '/login';

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <CartProvider>
          {!isAdmin && <Navbar />}
          <main className={isAdmin ? '' : 'pt-16'}>
            <Outlet />
          </main>
          {!isAdmin && <Footer />}
        </CartProvider>
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const nonce = useNonce();
  let errorMessage = 'Unknown error';
  let errorStatus = 500;

  if (isRouteErrorResponse(error)) {
    errorStatus = error.status;
    errorMessage = error.data;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  }

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body style={{backgroundColor: '#0D0D0D', color: '#FFFFFF', fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', margin: 0}}>
        <div style={{textAlign: 'center'}}>
          <h1 style={{fontFamily: '"Bebas Neue", sans-serif', fontSize: '6rem', margin: 0}}>{errorStatus}</h1>
          <p style={{color: '#AAAAAA'}}>{errorMessage}</p>
          <a href="/" style={{color: '#CC0000', textDecoration: 'none'}}>Return Home</a>
        </div>
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}
