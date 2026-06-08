import {json} from '@shopify/remix-oxygen';
import {useActionData, Form, Link} from '@remix-run/react';
import {createClient} from '@supabase/supabase-js';

export const meta = () => [{title: 'Forgot Password | BlackCrow Admin'}];

export async function loader() {
  return json({});
}

export async function action({request, context}) {
  const {env} = context;
  const formData = await request.formData();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();

  if (!email) return json({error: 'Email is required.'});

  const supabaseUrl = process.env.SUPABASE_URL ?? env?.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY ?? env?.SUPABASE_ANON_KEY;
  const appUrl = process.env.APP_URL ?? env?.APP_URL ?? 'http://localhost:3000';

  if (supabaseUrl && supabaseKey) {
    const sb = createClient(supabaseUrl, supabaseKey, {auth: {persistSession: false}});
    await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl}/auth/reset-password`,
    });
  }

  // Always return success — do not reveal whether the email exists
  return json({sent: true});
}

export default function ForgotPasswordPage() {
  const data = useActionData();

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
          FORGOT PASSWORD
        </h1>
        <p
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '0.78rem',
            color: '#888',
            margin: '0 0 24px 0',
          }}
        >
          Enter your email and we&rsquo;ll send a reset link.
        </p>

        {data?.sent ? (
          <div
            style={{
              background: 'rgba(34,197,94,0.1)',
              border: '1px solid rgba(34,197,94,0.3)',
              borderRadius: '8px',
              padding: '14px',
              fontFamily: 'Inter, sans-serif',
              fontSize: '0.82rem',
              color: '#86efac',
              marginBottom: '20px',
            }}
          >
            If that email is registered, a reset link has been sent. Check your inbox.
          </div>
        ) : (
          <Form method="post" style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
            {data?.error && (
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
                {data.error}
              </div>
            )}
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
              Send Reset Link
            </button>
          </Form>
        )}

        <div style={{textAlign: 'center', marginTop: '20px'}}>
          <Link
            to="/login"
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '0.75rem',
              color: '#666',
              textDecoration: 'none',
            }}
            onMouseEnter={(e) => (e.target.style.color = '#CC0000')}
            onMouseLeave={(e) => (e.target.style.color = '#666')}
          >
            ← Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
