/**
 * Launchpad design primitives — the small, repeated pieces every launchpad
 * surface shares (avatar, stage pill, % change, graduation bar, inline stat).
 *
 * Colours stay on theme tokens; up/down use the 600/400 shades so they pass
 * AA on both the ivory and near-black backgrounds.
 */
import type { ReactNode } from 'react';
import type { TokenStage } from '@/hooks/useTokens';
import { cn } from '@/lib/utils';

export const UP = 'text-emerald-600 dark:text-emerald-400';
export const DOWN = 'text-red-600 dark:text-red-400';

export function Change({
  value,
  className,
  suffix,
}: {
  value: number | null | undefined;
  className?: string;
  suffix?: string;
}) {
  if (value == null || !Number.isFinite(value)) {
    return (
      <span className={cn('font-mono tabular-nums text-muted-foreground', className)}>--</span>
    );
  }
  return (
    <span className={cn('font-mono tabular-nums', value >= 0 ? UP : DOWN, className)}>
      {value >= 0 ? '+' : ''}
      {value.toFixed(1)}%{suffix ? <span className="text-muted-foreground"> {suffix}</span> : null}
    </span>
  );
}

const AVATAR_SIZES = {
  sm: 'h-6 w-6 text-[9px] rounded-md',
  md: 'h-10 w-10 text-xs rounded-lg',
  lg: 'h-16 w-16 text-sm rounded-xl',
  xl: 'h-20 w-20 text-base rounded-2xl',
} as const;

export function TokenAvatar({
  imageURL,
  symbol,
  size = 'md',
  className,
}: {
  imageURL?: string | null;
  symbol: string;
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
}) {
  const s = AVATAR_SIZES[size];
  if (imageURL) {
    return (
      <img
        src={imageURL}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn(s, 'flex-shrink-0 bg-muted object-cover', className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        s,
        'flex flex-shrink-0 items-center justify-center bg-primary/15 font-bold text-primary',
        className
      )}
    >
      {symbol.slice(0, 3)}
    </span>
  );
}

const STAGE_META: Record<TokenStage, { label: string; dot: string; text: string }> = {
  bonding: { label: 'Bonding', dot: 'bg-primary', text: 'text-primary' },
  graduating: {
    label: 'Graduating',
    dot: 'bg-amber-500 animate-pulse',
    text: 'text-amber-600 dark:text-amber-400',
  },
  graduated: { label: 'Graduated', dot: 'bg-emerald-500', text: UP },
  halted: { label: 'Halted', dot: 'bg-red-500', text: DOWN },
};

export function StagePill({ stage, className }: { stage: TokenStage; className?: string }) {
  const m = STAGE_META[stage];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide backdrop-blur-sm',
        m.text,
        className
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full motion-reduce:animate-none', m.dot)} />
      {m.label}
    </span>
  );
}

/** Thin progress bar toward graduation. `pct` is 0..100. */
export function GraduationBar({
  pct,
  stage,
  className,
}: {
  pct: number;
  stage: TokenStage;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const fill =
    stage === 'halted'
      ? 'bg-red-500'
      : stage === 'graduated'
        ? 'bg-emerald-500'
        : stage === 'graduating'
          ? 'bg-amber-500'
          : 'bg-primary';
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label="Graduation progress"
      className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none',
          fill
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** Label-over-value stat used in the divided stat strips. */
export function Stat({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 px-4 py-3', className)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-lg font-semibold tabular-nums">{value}</p>
      {sub != null && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Bordered panel with an optional titled header row. */
export function Panel({
  title,
  icon,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-border bg-card', className)}>
      {title != null && (
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          {icon}
          <h2 className="text-sm font-semibold">{title}</h2>
          {action != null && <div className="ml-auto">{action}</div>}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
