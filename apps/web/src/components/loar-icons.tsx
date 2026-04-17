/**
 * LoarIcon — Custom SVG icon set replacing all emoji usage across the site.
 *
 * Design language: sharp geometric shapes, cinematic feel, amber/violet accents.
 * All icons use currentColor by default so they inherit text color from parent.
 * Stroke-based with 1.5px weight to match Lucide icons used elsewhere.
 */

import type { SVGProps } from 'react';

export type LoarIconName =
  | 'seedling'
  | 'bolt'
  | 'flame'
  | 'explosion'
  | 'glowing-star'
  | 'gem'
  | 'crown'
  | 'hero'
  | 'scroll'
  | 'clapperboard'
  | 'ballot'
  | 'star'
  | 'memo'
  | 'dna'
  | 'crowd'
  | 'megaphone'
  | 'money-bag'
  | 'gallery'
  | 'mobile'
  | 'camera'
  | 'check-circle'
  | 'check'
  | 'cross'
  | 'alarm'
  | 'sparkle'
  | 'command'
  | 'square';

interface LoarIconProps extends SVGProps<SVGSVGElement> {
  name: LoarIconName;
  size?: number | string;
}

const icons: Record<LoarIconName, (props: SVGProps<SVGSVGElement>) => JSX.Element> = {
  /* ── Daily Checkin Streak ──────────────────────────────── */

  seedling: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M12 22V12" />
      <path d="M12 12C12 8 8 4 4 4c0 4 4 8 8 8z" />
      <path d="M12 15c0-3 3-6 6-8-1 4-3 7-6 8z" />
    </svg>
  ),

  bolt: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  ),

  flame: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M12 22c-4-2-7-6-7-10 0-3 2-5 3-7 1 2 2 3 4 3 0-3 1-6 3-8 1 3 4 6 4 12 0 4-3 8-7 10z" />
      <path d="M12 22c-1.5-1-3-3-3-5s1.5-3 3-4c1.5 1 3 2 3 4s-1.5 4-3 5z" />
    </svg>
  ),

  explosion: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M12 2l2 5 5-1-3 4 4 3-5 1 1 5-4-3-4 3 1-5-5-1 4-3-3-4 5 1z" />
    </svg>
  ),

  'glowing-star': (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M12 2l3 6.5L22 10l-5 5 1.5 7L12 18.5 5.5 22 7 15 2 10l7-1.5z" />
      <path d="M12 6v2M8 12H6M18 12h-2M9 8L7.5 6.5M15 8l1.5-1.5" opacity="0.5" />
    </svg>
  ),

  gem: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M6 3h12l4 7-10 12L2 10z" />
      <path d="M2 10h20" />
      <path d="M12 22L8 10l4-7 4 7z" />
    </svg>
  ),

  crown: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M3 18h18V9l-4 4-5-7-5 7-4-4v9z" />
      <path d="M3 18l1 2h16l1-2" />
    </svg>
  ),

  /* ── Flow Nodes ────────────────────────────────────────── */

  hero: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <circle cx="12" cy="7" r="4" />
      <path d="M5 21v-2a5 5 0 015-5h4a5 5 0 015 5v2" />
      <path d="M15 3l2 2-2 2" />
      <path d="M9 3L7 5l2 2" />
    </svg>
  ),

  scroll: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M17 6V4a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2h2" />
      <path d="M17 6h2a2 2 0 012 2v10a2 2 0 01-2 2h-8a2 2 0 01-2-2v-2" />
      <path d="M17 6H9" />
      <line x1="11" y1="11" x2="17" y2="11" />
      <line x1="11" y1="14" x2="15" y2="14" />
    </svg>
  ),

  clapperboard: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M4 8h16V6L4 6z" />
      <rect x="4" y="8" width="16" height="12" rx="1" />
      <path d="M8 6l2-4M14 6l2-4" />
      <circle cx="12" cy="14" r="2" />
    </svg>
  ),

  ballot: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 12h10" />
      <path d="M7 8h6" />
      <path d="M7 16h8" />
      <path d="M16 8l1.5 1.5L20 6" opacity="0.7" />
    </svg>
  ),

  star: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M12 2l3 6.5L22 10l-5 5 1.5 7L12 18.5 5.5 22 7 15 2 10l7-1.5z" />
    </svg>
  ),

  memo: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="8" y1="7" x2="16" y2="7" />
      <line x1="8" y1="11" x2="16" y2="11" />
      <line x1="8" y1="15" x2="13" y2="15" />
    </svg>
  ),

  /* ── Monetization ──────────────────────────────────────── */

  dna: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M7 2c0 4 10 6 10 10S7 16 7 22" />
      <path d="M17 2c0 4-10 6-10 10s10 6 10 10" />
      <line x1="7" y1="7" x2="17" y2="7" opacity="0.5" />
      <line x1="7" y1="12" x2="17" y2="12" opacity="0.5" />
      <line x1="7" y1="17" x2="17" y2="17" opacity="0.5" />
    </svg>
  ),

  crowd: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <circle cx="9" cy="7" r="3" />
      <circle cx="17" cy="7" r="2.5" />
      <path d="M3 21v-1.5a4 4 0 014-4h4a4 4 0 014 4V21" />
      <path d="M17 11.5a3 3 0 013 3V21" />
    </svg>
  ),

  megaphone: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M18 4L6 9h-2a2 2 0 00-2 2v2a2 2 0 002 2h2l12 5V4z" />
      <path d="M22 9c1 1 1 5 0 6" />
      <path d="M8 15v4a1 1 0 001 1h2a1 1 0 001-1v-3" />
    </svg>
  ),

  'money-bag': (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M9 3h6l-3 4-3-4z" />
      <path d="M12 7c-5 2-7 5-7 9 0 3 3 5 7 5s7-2 7-5c0-4-2-7-7-9z" />
      <path d="M10 14.5c0-.8.9-1.5 2-1.5s2 .7 2 1.5-.9 1.5-2 1.5-2 .7-2 1.5.9 1.5 2 1.5 2-.7 2-1.5" />
    </svg>
  ),

  /* ── Media & Content ───────────────────────────────────── */

  gallery: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  ),

  mobile: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <line x1="10" y1="18" x2="14" y2="18" />
    </svg>
  ),

  camera: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M15 3h-6l-2 3H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-3l-2-3z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  ),

  square: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <rect x="4" y="4" width="16" height="16" rx="1" />
    </svg>
  ),

  /* ── Status & UI ───────────────────────────────────────── */

  'check-circle': (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12l3 3 5-5" />
    </svg>
  ),

  check: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M5 12l5 5L20 7" />
    </svg>
  ),

  cross: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  ),

  alarm: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5" />
      <path d="M5 3L2 6M19 3l3 3" />
    </svg>
  ),

  sparkle: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z" />
      <path d="M18 14l.75 2.25L21 17l-2.25.75L18 20l-.75-2.25L15 17l2.25-.75z" opacity="0.6" />
    </svg>
  ),

  command: (p) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M15 6.5a2.5 2.5 0 112.5 2.5H6.5A2.5 2.5 0 119 6.5V17.5A2.5 2.5 0 116.5 15h11a2.5 2.5 0 11-2.5 2.5V6.5z" />
    </svg>
  ),
};

export function LoarIcon({ name, size = '1em', className, ...rest }: LoarIconProps) {
  const IconFn = icons[name];
  if (!IconFn) return null;

  return <IconFn width={size} height={size} className={className} aria-hidden="true" {...rest} />;
}

/**
 * Shorthand for inline icon usage in text contexts.
 * Returns a small inline icon matching the surrounding text size.
 */
export function loarIcon(name: LoarIconName, className?: string) {
  return (
    <LoarIcon
      name={name}
      size="1em"
      className={`inline-block align-[-0.125em] ${className ?? ''}`}
    />
  );
}
