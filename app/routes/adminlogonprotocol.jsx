import {json} from '@shopify/remix-oxygen';
import {useState, useEffect} from 'react';
import {Link, Outlet, useLoaderData, Form} from '@remix-run/react';
import {AdminSidebar} from '~/components/AdminSidebar';
import {requireAdminUser} from '~/lib/auth.server';

export const meta = () => [{title: 'Admin | BlackCrow'}];

export async function loader({request, context}) {
  const user = await requireAdminUser(request);
  const url  = new URL(request.url);
  const accessDenied = url.searchParams.get('access_denied') === '1';
  return json({user, accessDenied});
}

export default function AdminLayout() {
  const {user, accessDenied} = useLoaderData();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showBanner, setShowBanner]   = useState(accessDenied);

  useEffect(() => {
    if (accessDenied) {
      const t = setTimeout(() => setShowBanner(false), 4000);
      return () => clearTimeout(t);
    }
  }, [accessDenied]);

  return (
    <div className="min-h-screen bg-bc-bg">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} user={user} />

      {/* Access Denied Banner */}
      {showBanner && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 200,
            background: 'rgba(204,0,0,0.92)',
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '0.82rem',
              color: '#fff',
              letterSpacing: '0.04em',
            }}
          >
            Access Denied — You do not have permission to view that page.
          </span>
          <button
            onClick={() => setShowBanner(false)}
            style={{background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1rem', padding: '0 4px'}}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top bar */}
      <div
        className="border-b border-bc-divider px-4 sm:px-6 py-4 flex items-center justify-between sticky bg-bc-bg z-10 overflow-x-hidden"
        style={{top: showBanner ? 40 : 0, transition: 'top 0.2s'}}
      >
        <div className="flex items-center gap-4">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="text-bc-secondary hover:text-white transition-colors duration-150 p-1 -ml-1"
            aria-label="Open menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <Link to="/">
            <img src="/images/logo-stacked.png" alt="BlackCrow" className="h-8 w-auto object-contain" />
          </Link>
          <span className="hidden sm:inline font-ui text-[0.65rem] tracking-[0.16em] uppercase text-bc-secondary border-l border-bc-divider pl-4">
            Admin Dashboard
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Live indicator */}
          <div className="hidden sm:flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#22c55e] inline-block" />
            <span className="font-ui text-[0.72rem] text-bc-secondary">Live</span>
          </div>

          {/* User info */}
          <div
            className="flex items-center gap-2 pl-4"
            style={{borderLeft: '1px solid rgba(255,255,255,0.07)'}}
          >
            <div className="text-right hidden sm:block">
              <p className="font-ui text-[0.72rem] text-white leading-tight">
                {user.full_name || user.email}
              </p>
              <p className="font-ui text-[0.62rem] text-bc-secondary leading-tight">
                {user.role}
                {user.country_access?.length ? ` · ${user.country_access[0]}` : ''}
              </p>
            </div>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: 'rgba(204,0,0,0.18)',
                border: '1px solid rgba(204,0,0,0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#CC0000',
                fontSize: '0.78rem',
                fontWeight: 700,
                fontFamily: 'Inter, sans-serif',
                flexShrink: 0,
              }}
            >
              {(user.full_name || user.email || '?')[0].toUpperCase()}
            </div>
          </div>

          {/* Logout */}
          <Form method="post" action="/auth/logout">
            <button
              type="submit"
              className="font-ui text-[0.72rem] text-bc-secondary hover:text-bc-red transition-colors duration-150 flex items-center gap-1.5 pl-3"
              style={{borderLeft: '1px solid rgba(255,255,255,0.07)'}}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              <span className="hidden sm:inline">Logout</span>
            </button>
          </Form>
        </div>
      </div>

      {/* Page content rendered by child routes */}
      <Outlet />
    </div>
  );
}
