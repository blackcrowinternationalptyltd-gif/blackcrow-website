import {json, redirect} from '@shopify/remix-oxygen';
import {useActionData, Form, Link} from '@remix-run/react';
import {createClient} from '@supabase/supabase-js';
import {getSession, commitSession} from '~/lib/session.server';

export const meta = () => [{title: 'Admin Login | BlackCrow'}];

export async function loader({request}) {
  const session = await getSession(request);
  const user = session.get('adminUser');
  if (user) throw redirect('/adminlogonprotocol');
  return json({});
}

export async function action({request}) {
  const formData = await request.formData();
  const email    = String(formData.get('email')    ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return json({error: 'Email and password are required.'});
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return json({error: 'Authentication service not configured.'});
  }

  const sb = createClient(supabaseUrl, supabaseKey, {auth: {persistSession: false}});

  // Sign in with Supabase Auth
  const {data: authData, error: authError} = await sb.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData?.user) {
    return json({error: 'Invalid email or password.'});
  }

  // Look up profile for role and country
  const {data: profile, error: profileError} = await sb
    .from('profiles')
    .select('id, email, full_name, role, status, country_access')
    .eq('email', email)
    .maybeSingle();

  if (profileError || !profile) {
    return json({error: 'Account not found. Contact your administrator.'});
  }

  if (profile.status === 'suspended' || profile.status === 'disabled') {
    return json({error: 'Account is suspended. Contact your administrator.'});
  }

  // Only Final Admin and Country Admin can log in
  if (profile.role !== 'Final Admin' && profile.role !== 'Country Admin') {
    return json({error: 'You do not have admin access.'});
  }

  // Store user in session cookie
  const session = await getSession(request);
  session.set('adminUser', {
    id:             profile.id,
    email:          profile.email,
    full_name:      profile.full_name ?? email,
    role:           profile.role,
    country_access: profile.country_access ?? null,
  });

  return redirect('/adminlogonprotocol', {
    headers: {'Set-Cookie': await commitSession(session)},
  });
}

export default function LoginPage() {
  const data = useActionData();
  const error = data?.error;

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        background: '#0D0D0D',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'clamp(12px, 4vw, 24px)',
        boxSizing: 'border-box',
      }}
    >
      {/* Logo */}
      <div style={{marginBottom: '32px', textAlign: 'center'}}>
        <img
          src="/images/logo-stacked.png"
          alt="BlackCrow"
          style={{height: '56px', width: 'auto', maxWidth: '100%', objectFit: 'contain'}}
        />
      </div>

      {/* Card */}
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: '16px',
          padding: 'clamp(20px, 6vw, 36px) clamp(16px, 5vw, 32px)',
          boxSizing: 'border-box',
        }}
      >
        <h1
          style={{
            fontFamily: '"Bebas Neue", sans-serif',
            fontSize: 'clamp(1.5rem, 6vw, 2rem)',
            letterSpacing: '0.12em',
            color: '#FFFFFF',
            margin: '0 0 4px 0',
          }}
        >
          ADMIN LOGIN
        </h1>
        <p
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '0.78rem',
            letterSpacing: '0.06em',
            color: '#888',
            margin: '0 0 28px 0',
          }}
        >
          BlackCrow Admin Dashboard
        </p>

        {error && (
          <div
            style={{
              background: 'rgba(204,0,0,0.12)',
              border: '1px solid rgba(204,0,0,0.3)',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '20px',
              fontFamily: 'Inter, sans-serif',
              fontSize: '0.8rem',
              color: '#ff6b6b',
            }}
          >
            {error}
          </div>
        )}

        <Form method="post" style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
          <div>
            <label
              htmlFor="email"
              style={{
                display: 'block',
                fontFamily: 'Inter, sans-serif',
                fontSize: '0.7rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#888',
                marginBottom: '6px',
              }}
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                padding: '10px 14px',
                fontFamily: 'Inter, sans-serif',
                fontSize: '0.875rem',
                color: '#FFFFFF',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'rgba(204,0,0,0.6)')}
              onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                fontFamily: 'Inter, sans-serif',
                fontSize: '0.7rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#888',
                marginBottom: '6px',
              }}
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                padding: '10px 14px',
                fontFamily: 'Inter, sans-serif',
                fontSize: '0.875rem',
                color: '#FFFFFF',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'rgba(204,0,0,0.6)')}
              onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
            />
          </div>

          <button
            type="submit"
            style={{
              width: '100%',
              background: '#CC0000',
              border: 'none',
              borderRadius: '8px',
              padding: '12px',
              fontFamily: 'Inter, sans-serif',
              fontSize: '0.8rem',
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#FFFFFF',
              cursor: 'pointer',
              marginTop: '4px',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.target.style.background = '#AA0000')}
            onMouseLeave={(e) => (e.target.style.background = '#CC0000')}
          >
            Sign In
          </button>
        </Form>

        <div style={{textAlign: 'center', marginTop: '20px'}}>
          <Link
            to="/auth/forgot-password"
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '0.75rem',
              color: '#666',
              textDecoration: 'none',
              letterSpacing: '0.04em',
            }}
            onMouseEnter={(e) => (e.target.style.color = '#CC0000')}
            onMouseLeave={(e) => (e.target.style.color = '#666')}
          >
            Forgot password?
          </Link>
        </div>
      </div>

      <p
        style={{
          marginTop: '24px',
          fontFamily: 'Inter, sans-serif',
          fontSize: '0.65rem',
          letterSpacing: '0.08em',
          color: '#444',
          textTransform: 'uppercase',
        }}
      >
        BLACKCROW ADMIN v1.0
      </p>
    </div>
  );
}
