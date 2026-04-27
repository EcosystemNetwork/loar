import { useEffect, useState } from 'react';

const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

function read(bp: Breakpoint): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(`(min-width: ${BREAKPOINTS[bp]}px)`).matches;
}

export function useBreakpoint(bp: Breakpoint): boolean {
  const [matches, setMatches] = useState(() => read(bp));
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${BREAKPOINTS[bp]}px)`);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [bp]);
  return matches;
}

export function useIsMobile(): boolean {
  return !useBreakpoint('md');
}

export function useIsTablet(): boolean {
  const md = useBreakpoint('md');
  const lg = useBreakpoint('lg');
  return md && !lg;
}

export function useIsDesktop(): boolean {
  return useBreakpoint('lg');
}
