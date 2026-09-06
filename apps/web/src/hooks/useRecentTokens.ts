/**
 * useRecentTokens — a small localStorage-backed MRU list of token addresses the
 * user has opened. The detail page calls `pushRecent(address)` on mount; the
 * launchpad renders the list as a "recently viewed" rail.
 */
import { useCallback, useEffect, useState } from 'react';

const LS_KEY = 'loar_recent_tokens_v1';
const MAX = 12;

function read(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list: string[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* non-fatal */
  }
}

/** Prepend `address` to the MRU list (dedup, cap at MAX). Safe to call in an effect. */
export function pushRecentToken(address: string) {
  if (!address) return;
  const key = address.toLowerCase();
  const next = [key, ...read().filter((a) => a.toLowerCase() !== key)].slice(0, MAX);
  write(next);
  try {
    window.dispatchEvent(new CustomEvent('loar:recent-tokens'));
  } catch {
    /* no-op */
  }
}

export function useRecentTokens(): string[] {
  const [list, setList] = useState<string[]>(() => (typeof window === 'undefined' ? [] : read()));

  useEffect(() => {
    const refresh = () => setList(read());
    window.addEventListener('loar:recent-tokens', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('loar:recent-tokens', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const clear = useCallback(() => {
    write([]);
    setList([]);
  }, []);

  // expose clear via the array's identity is awkward; callers that need it can
  // import a dedicated helper. Keep the hook's contract a plain string[].
  void clear;
  return list;
}
