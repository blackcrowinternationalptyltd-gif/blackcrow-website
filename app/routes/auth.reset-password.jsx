import {json} from '@shopify/remix-oxygen';
import {useLoaderData, Link} from '@remix-run/react';
import {useEffect, useState, useRef} from 'react';

export const meta = () => [{title: 'Reset Password | BlackCrow Admin'}];

export async function loader({context}) {
  const {env} = context;
  return json({
    supabaseUrl: process.env.SUPABASE_URL ?? env?.SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? env?.SUPABASE_ANON_KEY ?? '',
  });
}

export default function ResetPasswordPage() {
  const {supabaseUrl, supabaseAnonKey} = useLoaderData();
  const [status, setStatus]   = useState('loading'); // loading | ready | success | error
  const [message, setMessage] = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const sbRef = useRef(null);

  const inputStyle = {
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
  };

  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey) {
      setStatus('error');
      setMessage('Authentication service not configured.');
      return;
    }

    // Dynamically import Supabase client-side
    import('@supabase/supabase-js').then(({createClient}) => {
      const sb = createClient(supabaseUrl, supabaseAnonKey);
      sbRef.current = sb;

      // Supabase sends the recovery token as a URL code param (PKCE flow)
      // OR as a hash with access_token (implicit flow)
      const url   = new URL(window.location.href);
      const code  = url.searchParams.get('code');
      const hash  = window.location.hash;

      if (code) {
        // PKCE flow: exchange code for session
        sb.auth.exchangeCodeForSession(code).then(({error}) => {
          if (error) {
            setStatus('error');
            setMessage('Reset link is invalid or has expired. Request a new one.');
          } else {
            setStatus('ready');
          }
        });
      } else if (hash.includes('access_token')) {
        // Implicit flow: session already set via hash
        sb.auth.getSession().then(({data}) => {
          if (data?.session) {
            setStatus('ready');
          } else {
            setStatus('error');
            setMessage('Reset link is invalid or has expired. Request a new one.');
          }
        });
      } else {
        setStatus('error');
        setMessage('No reset token found. Please request a new password reset.');
      }
    });
  }, [supabaseUrl, supabaseAnonKey]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) {
      setMessage('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setMessage('Password must be at least 8 characters.');
      return;
    }
    setMessage('');

    const sb = sbRef.current;
    if (!sb) return;

    const {error} = await sb.auth.updateUser({password});
    if (error) {
      setMessage(error.message || 'Failed to update password.');
    } else {
      setStatus('success');
    }
  }

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
      <div style={{marginBottom: '32px', textAlign: 'center'}}>
        <img
          src="/images/logo-stacked.png"
          alt="BlackCrow"
          style={{height: '56px', width: 'auto', maxWidth: '100%', objectFit: 'contain'}}
        />
      </div>

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
            fontSize: '1.8rem',
            letterSpacing: '0.12em',
            color: '#FFFFFF',
            margin: '0 0 4px 0',
          }}
        >
          RESET PASSWORD
        </h1>

        {status === 'loading' && (
          <p style={{fontFamily: 'Inter, sans-serif', fontSize: '0.82rem', color: '#888', marginTop: '16px'}}>
            Verifying reset link…
          </p>
        )}

        {status === 'error' && (
          <>
            <div
              style={{
                background: 'rgba(204,0,0,0.12)',
                border: '1px solid rgba(204,0,0,0.3)',
                borderRadius: '8px',
                padding: '12px 14px',
                fontFamily: 'Inter, sans-serif',
                fontSize: '0.82rem',
                color: '#ff6b6b',
                marginTop: '16px',
              }}
            >
              {message}
            </div>
            <div style={{textAlign: 'center', marginTop: '20px'}}>
              <Link
                to="/auth/forgot-password"
                style={{fontFamily: 'Inter, sans-serif', fontSize: '0.75rem', color: '#CC0000', textDecoration: 'none'}}
              >
                Request a new reset link
              </Link>
            </div>
          </>
        )}

        {status === 'ready' && (
          <form onSubmit={handleSubmit} style={{display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '20px'}}>
            {message && (
              <div
                style={{
                  background: 'rgba(204,0,0,0.12)',
                  border: '1px solid rgba(204,0,0,0.3)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '0.8rem',
                  color: '#ff6b6b',
                }}
              >
                {message}
              </div>
            )}
            <div>
              <label
                htmlFor="password"
                style={{display: 'block', fontFamily: 'Inter, sans-serif', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#888', marginBottom: '6px'}}
              >
                New Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = 'rgba(204,0,0,0.6)')}
                onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
              />
            </div>
            <div>
              <label
                htmlFor="confirm"
                style={{display: 'block', fontFamily: 'Inter, sans-serif', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#888', marginBottom: '6px'}}
              >
                Confirm Password
              </label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                style={inputStyle}
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
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.target.style.background = '#AA0000')}
              onMouseLeave={(e) => (e.target.style.background = '#CC0000')}
            >
              Set New Password
            </button>
          </form>
        )}

        {status === 'success' && (
          <>
            <div
              style={{
                background: 'rgba(34,197,94,0.1)',
                border: '1px solid rgba(34,197,94,0.3)',
                borderRadius: '8px',
                padding: '14px',
                fontFamily: 'Inter, sans-serif',
                fontSize: '0.82rem',
                color: '#86efac',
                marginTop: '16px',
              }}
            >
              Password updated successfully.
            </div>
            <div style={{textAlign: 'center', marginTop: '20px'}}>
              <Link
                to="/login"
                style={{fontFamily: 'Inter, sans-serif', fontSize: '0.82rem', color: '#CC0000', textDecoration: 'none', fontWeight: 600}}
              >
                Sign in with new password →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
