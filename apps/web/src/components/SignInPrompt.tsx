/**
 * SignInPrompt — the one sign-in gate for every page and panel.
 *
 * LOAR signs people in with email/social (Circle); the wallet is created for
 * them. So gates say "Sign in", never "Connect your wallet" — wallet language
 * belongs to on-chain actions only, behind the web3-mode toggle.
 *
 *   <SignInPrompt title="Sign in to view notifications" />
 *   <SignInPrompt variant="inline" title="Sign in to see your history" />
 *   requireSignIn('to vote')   // toast with a Sign in action
 *
 * The button returns the user to the page they were on after login.
 */

import type { ComponentType, ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { LogIn } from 'lucide-react';
import { toast } from 'sonner';
import { StateFrame, stateActionClass, type StateVariant } from '@/components/states';

function currentPath(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname + window.location.search;
}

type IconType = ComponentType<{ className?: string }>;

export interface SignInPromptProps {
  /** One line, starting with "Sign in" — e.g. "Sign in to manage personas". */
  title?: string;
  /** Optional second line: what they get after signing in. */
  description?: ReactNode;
  icon?: IconType;
  /** `page` centres in the viewport, `card` is a panel, `inline` is a compact row. */
  variant?: StateVariant;
  className?: string;
}

export function SignInPrompt({
  title = 'Sign in to continue',
  description,
  icon = LogIn,
  variant = 'card',
  className,
}: SignInPromptProps) {
  return (
    <StateFrame
      icon={icon}
      title={title}
      description={description}
      variant={variant}
      className={className}
      actions={
        <Link to="/login" search={{ redirect: currentPath() }} className={stateActionClass.primary}>
          <LogIn className="h-4 w-4" aria-hidden="true" />
          Sign in
        </Link>
      }
    />
  );
}

/**
 * Toast for actions attempted while signed out. `action` completes the
 * sentence "Sign in …", e.g. requireSignIn('to vote').
 */
export function requireSignIn(action = 'to continue'): void {
  toast.error(`Sign in ${action}`, {
    action: {
      label: 'Sign in',
      onClick: () => {
        window.location.assign(`/login?redirect=${encodeURIComponent(currentPath())}`);
      },
    },
  });
}
