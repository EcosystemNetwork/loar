/**
 * Shared state patterns — the one look for "nothing here", "something broke"
 * and "media unavailable". Every page uses these instead of inventing its own.
 *
 *   Empty   : icon + one sentence + one action        <EmptyState />
 *   Error   : what happened + retry (details folded)   <ErrorState />
 *   Media   : letterboxed placeholder, never a void    <MediaFallback />
 *   Sign in : see SignInPrompt (built on StateFrame)
 *
 * Variants: `page` centres in the viewport, `card` is a dashed panel inside a
 * page, `inline` is a compact row for lists and dialogs.
 */

import type { ComponentType, ReactNode } from 'react';
import { AlertTriangle, ImageOff, Inbox, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

type IconType = ComponentType<{ className?: string }>;
export type StateVariant = 'page' | 'card' | 'inline';

export interface StateFrameProps {
  icon?: IconType;
  title: ReactNode;
  description?: ReactNode;
  /** Primary action (and optionally one secondary). Keep it to one or two. */
  actions?: ReactNode;
  variant?: StateVariant;
  tone?: 'default' | 'error';
  className?: string;
  children?: ReactNode;
}

/** The shared layout every state is built on. */
export function StateFrame({
  icon: Icon = Inbox,
  title,
  description,
  actions,
  variant = 'card',
  tone = 'default',
  className,
  children,
}: StateFrameProps) {
  const tile =
    tone === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary';

  if (variant === 'inline') {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center justify-center gap-3 py-4 text-sm text-muted-foreground',
          className
        )}
        role={tone === 'error' ? 'alert' : undefined}
      >
        {title && <span>{title}</span>}
        {actions}
      </div>
    );
  }

  const body = (
    <div
      className="mx-auto flex max-w-sm flex-col items-center gap-3 text-center"
      role={tone === 'error' ? 'alert' : undefined}
    >
      <span className={cn('flex h-11 w-11 items-center justify-center rounded-xl', tile)}>
        <Icon className="h-5 w-5" />
      </span>
      <h2 className="text-lg font-semibold text-foreground text-balance">{title}</h2>
      {description && <p className="text-sm text-muted-foreground text-pretty">{description}</p>}
      {actions && <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div>}
      {children}
    </div>
  );

  if (variant === 'page') {
    return (
      <div className={cn('flex min-h-[60vh] items-center justify-center px-4 py-16', className)}>
        {body}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-2xl border border-dashed border-border/60 bg-card/30 px-6 py-12',
        className
      )}
    >
      {body}
    </div>
  );
}

/** Button-styled class strings so actions look the same whether they are a
 *  <Link>, <a> or <button>. */
export const stateActionClass = {
  primary:
    'inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors duration-100 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  secondary:
    'inline-flex items-center gap-2 rounded-lg border border-border/60 px-4 py-2 text-sm font-medium text-foreground transition-colors duration-100 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
} as const;

export type EmptyStateProps = Omit<StateFrameProps, 'tone'>;

/** Nothing here yet: icon + one sentence + one action. */
export function EmptyState(props: EmptyStateProps) {
  return <StateFrame {...props} />;
}

export interface ErrorStateProps extends Omit<StateFrameProps, 'tone' | 'title' | 'actions'> {
  title?: ReactNode;
  /** Raw error — shown folded under "Details", never as the headline. */
  error?: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  /** Extra action next to retry (e.g. a "Go home" link). */
  secondaryAction?: ReactNode;
}

function errorText(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Something broke: what happened + retry. Technical detail stays folded. */
export function ErrorState({
  title = 'Something went wrong',
  description = 'This didn’t load. Check your connection and try again.',
  error,
  onRetry,
  retryLabel = 'Try again',
  secondaryAction,
  icon = AlertTriangle,
  ...rest
}: ErrorStateProps) {
  const detail = errorText(error);
  return (
    <StateFrame
      {...rest}
      icon={icon}
      tone="error"
      title={title}
      description={description}
      actions={
        onRetry || secondaryAction ? (
          <>
            {onRetry && (
              <button type="button" onClick={onRetry} className={stateActionClass.secondary}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {retryLabel}
              </button>
            )}
            {secondaryAction}
          </>
        ) : undefined
      }
    >
      {detail && (
        <details className="mt-2 w-full text-left text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none text-center">Details</summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 font-mono">
            {detail}
          </pre>
        </details>
      )}
    </StateFrame>
  );
}

/** Designed placeholder for media that is missing or failed to load. Fills
 *  its (positioned) parent — never a black rectangle. */
export function MediaFallback({
  label = 'Image unavailable',
  title,
  className,
}: {
  label?: string;
  /** Optional caption, e.g. the asset's title, so the tile still means something. */
  title?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-gradient-to-b from-muted to-muted/60 px-3 text-center text-muted-foreground',
        className
      )}
      role="img"
      aria-label={title ? `${title} — ${label}` : label}
    >
      <ImageOff className="h-5 w-5 opacity-50" aria-hidden="true" />
      {title && (
        <span className="line-clamp-2 text-xs font-medium text-foreground/70">{title}</span>
      )}
      <span className="text-[10px] uppercase tracking-wider opacity-60">{label}</span>
    </div>
  );
}
