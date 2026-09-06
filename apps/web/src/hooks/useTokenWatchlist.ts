/**
 * useTokenWatchlist — a single hook for "starred" tokens across the launchpad
 * and detail pages.
 *
 * localStorage is the instant source of truth (works logged-out, no round-trip).
 * When the user is authenticated we also mirror writes to
 * `tokenSocial.watch/unwatch` and merge the server list in on load so the
 * watchlist follows them across devices.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc, trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';

const LS_KEY = 'loar_token_watchlist_v1';

function readLocal(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((s: string) => s.toLowerCase()) : [];
  } catch {
    return [];
  }
}

function writeLocal(list: string[]) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify(Array.from(new Set(list.map((s) => s.toLowerCase()))))
    );
  } catch {
    /* private mode / quota — non-fatal */
  }
}

export function useTokenWatchlist() {
  const { isAuthenticated } = useWalletAuth();
  const queryClient = useQueryClient();
  const [local, setLocal] = useState<string[]>(() =>
    typeof window === 'undefined' ? [] : readLocal()
  );

  const serverQuery = useQuery({
    ...trpc.tokenSocial.getWatchlist.queryOptions(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  // Merge the server list into local once it arrives so both stay in sync.
  useEffect(() => {
    if (!serverQuery.data) return;
    const serverAddrs = (serverQuery.data as unknown as Array<{ tokenAddress?: string }>)
      .map((r) => r.tokenAddress?.toLowerCase())
      .filter((a): a is string => !!a);
    if (!serverAddrs.length) return;
    setLocal((prev) => {
      const merged = Array.from(new Set([...prev, ...serverAddrs]));
      if (merged.length !== prev.length) writeLocal(merged);
      return merged;
    });
  }, [serverQuery.data]);

  const watched = useMemo(() => new Set(local.map((s) => s.toLowerCase())), [local]);

  const isWatched = useCallback((addr: string) => watched.has(addr.toLowerCase()), [watched]);

  const toggle = useCallback(
    (addr: string, symbol?: string) => {
      const key = addr.toLowerCase();
      setLocal((prev) => {
        const has = prev.includes(key);
        const next = has ? prev.filter((a) => a !== key) : [...prev, key];
        writeLocal(next);
        if (isAuthenticated) {
          const call = has
            ? trpcClient.tokenSocial.unwatch.mutate({ tokenAddress: key })
            : trpcClient.tokenSocial.watch.mutate({ tokenAddress: key, tokenSymbol: symbol });
          Promise.resolve(call)
            .then(() => {
              queryClient.invalidateQueries({ queryKey: ['token-watching', addr] });
            })
            .catch(() => {
              /* keep the optimistic local state; server will reconcile next load */
            });
        }
        return next;
      });
    },
    [isAuthenticated, queryClient]
  );

  return { watched, isWatched, toggle, count: watched.size };
}
