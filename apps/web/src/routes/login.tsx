/**
 * Login Route — Email / Social Sign-In via Circle DCW
 *
 * Users can sign in with email (OTP verification) or social providers.
 * After verification, a Circle wallet is auto-created and a JWT session is set.
 */

import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useWalletAuth, requestEmailOTP } from '@/lib/wallet-auth';
import { CHAIN_NAMES, SUPPORTED_CHAIN_IDS } from '@/configs/chains';
import { useState, useEffect, useRef } from 'react';
import { z } from 'zod';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined;
const APPLE_CLIENT_ID = import.meta.env.VITE_APPLE_OAUTH_CLIENT_ID as string | undefined;

// Loaded once per page — both scripts are idempotent (no-op on repeat).
function loadScript(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) return resolve();
    const s = document.createElement('script');
    s.id = id;
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

const loginSearchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute('/login')({
  component: LoginPage,
  validateSearch: loginSearchSchema,
});

function LoginPage() {
  const {
    isAuthenticated,
    signInWithEmail,
    signInWithSocial,
    isAuthenticating,
    error: authError,
  } = useWalletAuth();
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: '/login' });

  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  // Redirect once authenticated — only allow internal paths (prevent open redirect)
  useEffect(() => {
    if (isAuthenticated) {
      const target =
        redirect && redirect.startsWith('/') && !redirect.startsWith('//')
          ? redirect
          : '/dashboard';
      navigate({ to: target });
    }
  }, [isAuthenticated, navigate, redirect]);

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSending(true);

    try {
      const result = await requestEmailOTP(email);
      setStep('otp');

      // In dev mode, auto-fill the OTP for testing
      if (result._devOtp) {
        setOtpCode(result._devOtp);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      await signInWithEmail(email, otpCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    }
  };

  // ── Google Identity Services button ──────────────────────────────────────
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleBtnRef.current) return;
    let cancelled = false;

    loadScript('https://accounts.google.com/gsi/client', 'google-identity-services')
      .then(() => {
        if (cancelled) return;
        const g = (window as any).google;
        if (!g?.accounts?.id || !googleBtnRef.current) return;
        g.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response: { credential?: string }) => {
            if (!response.credential) return;
            try {
              setError(null);
              await signInWithSocial('google', response.credential);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Google sign-in failed');
            }
          },
        });
        g.accounts.id.renderButton(googleBtnRef.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: 320,
        });
      })
      .catch((err) => {
        console.warn('[auth] Google Identity Services failed to load:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [signInWithSocial]);

  // ── Apple Sign-In (popup flow) ───────────────────────────────────────────
  const handleAppleSignIn = async () => {
    if (!APPLE_CLIENT_ID) return;
    try {
      await loadScript(
        'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js',
        'apple-id-auth'
      );
      const AppleID = (window as any).AppleID;
      if (!AppleID?.auth) throw new Error('Apple ID SDK not available');

      AppleID.auth.init({
        clientId: APPLE_CLIENT_ID,
        scope: 'name email',
        redirectURI: window.location.origin + '/login',
        usePopup: true,
      });

      const result = await AppleID.auth.signIn();
      const idToken = result?.authorization?.id_token;
      if (!idToken) throw new Error('No id_token from Apple');

      setError(null);
      await signInWithSocial('apple', idToken);
    } catch (err: any) {
      // Apple's popup throws { error: 'popup_closed_by_user' } on cancel — swallow that
      if (err?.error === 'popup_closed_by_user') return;
      setError(err instanceof Error ? err.message : 'Apple sign-in failed');
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-10">
        {/* Brand */}
        <div className="text-center space-y-3">
          <img src="/loarIconTextLogo.png" alt="LOAR" className="h-10 w-auto mx-auto" />
          <p className="text-sm text-muted-foreground font-light">
            AI cinematic universes, on-chain
          </p>
        </div>

        {/* Sign In Form */}
        <div className="space-y-6">
          <div className="text-center space-y-1.5">
            <h1 className="text-2xl font-display italic">Sign in</h1>
            <p className="text-sm text-muted-foreground">
              {step === 'email' ? 'Enter your email to get started' : `We sent a code to ${email}`}
            </p>
          </div>

          {step === 'email' ? (
            <form onSubmit={handleSendOTP} className="space-y-4">
              <div>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={isSending || !email}
                className="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-lg shadow-indigo-500/25 transition-all duration-200"
              >
                {isSending ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                        strokeDasharray="32"
                        strokeDashoffset="8"
                      />
                    </svg>
                    Sending…
                  </span>
                ) : (
                  'Continue with Email'
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP} className="space-y-4">
              <div>
                <input
                  id="login-otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter 6-digit code"
                  required
                  autoFocus
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-center text-2xl tracking-[0.3em] font-mono placeholder:text-white/30 placeholder:text-base placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={isAuthenticating || otpCode.length < 6}
                className="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-lg shadow-indigo-500/25 transition-all duration-200"
              >
                {isAuthenticating ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                        strokeDasharray="32"
                        strokeDashoffset="8"
                      />
                    </svg>
                    Verifying…
                  </span>
                ) : (
                  'Verify & Sign In'
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setOtpCode('');
                  setError(null);
                }}
                className="w-full py-2 text-sm text-white/50 hover:text-white/70 transition-colors"
              >
                ← Use a different email
              </button>
            </form>
          )}

          {/* Error display */}
          {(error || authError) && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-400">{error || authError}</p>
            </div>
          )}

          {/* Social sign-in — only when the provider is configured */}
          {(GOOGLE_CLIENT_ID || APPLE_CLIENT_ID) && step === 'email' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
                <div className="flex-1 border-t border-border/50" />
                <span className="uppercase tracking-widest text-[10px]">or</span>
                <div className="flex-1 border-t border-border/50" />
              </div>
              {GOOGLE_CLIENT_ID && <div ref={googleBtnRef} className="flex justify-center" />}
              {APPLE_CLIENT_ID && (
                <button
                  type="button"
                  onClick={handleAppleSignIn}
                  disabled={isAuthenticating}
                  className="w-full py-3 flex items-center justify-center gap-2 bg-black hover:bg-zinc-900 disabled:opacity-50 text-white rounded-lg border border-white/10 transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M11.182.008C11.148-.03 9.923.023 8.857 1.18c-1.066 1.156-.902 2.482-.878 2.516.024.034 1.52.087 2.475-1.258.955-1.345.762-2.391.728-2.43Zm3.314 11.733c-.048-.096-2.325-1.234-2.113-3.422.212-2.189 1.675-2.789 1.698-2.854.023-.065-.597-.79-1.254-1.157a3.692 3.692 0 0 0-1.563-.434c-.108-.003-.483-.095-1.254.116-.508.139-1.653.589-1.968.607-.316.018-1.256-.522-2.267-.665-.647-.125-1.333.131-1.824.328-.49.196-1.422.754-2.074 2.237-.652 1.482-.311 3.83.203 5.117.514 1.287 1.258 2.655 2.245 2.659.983.023 1.334-.618 2.523-.612 1.189.005 1.502.622 2.517.606 1.014-.017 1.673-1.237 2.186-2.241.374-.691.678-1.432.96-2.213ZM9.5 3.01c.279-.275.5-.667.5-.675-.074.131-.326.493-.5.675Z" />
                  </svg>
                  <span className="text-sm font-medium">Continue with Apple</span>
                </button>
              )}
            </div>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
            <div className="flex-1 border-t border-border/50" />
            <span className="uppercase tracking-widest text-[10px]">
              {CHAIN_NAMES[SUPPORTED_CHAIN_IDS[0]] ?? 'Ethereum'}
            </span>
            <div className="flex-1 border-t border-border/50" />
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-muted-foreground/40">Secured by Circle</p>
      </div>
    </div>
  );
}
