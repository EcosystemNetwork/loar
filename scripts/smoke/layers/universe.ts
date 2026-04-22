/**
 * Layer 3 — universe
 * Checks: list all universes (public), get profile via JWT, create a
 * smoke-test universe (Firestore-only, no on-chain tx required).
 * Identifies: Firestore read/write failures, universe router bugs.
 */
import { privateKeyToAccount } from 'viem/accounts';
import type { SmokeConfig } from '../config.ts';
import { tRPCQuery, tRPCMutate, buildUniverseCreateMessage } from '../client.ts';
import { SMOKE_WALLETS, sampleUniverseMeta } from '../fixtures.ts';
import { check, type CheckResult } from '../reporter.ts';

export interface UniverseResult {
  universeId: string | undefined;
  checks: CheckResult[];
}

export async function runUniverseLayer(cfg: SmokeConfig, token: string): Promise<UniverseResult> {
  const results: CheckResult[] = [];
  let universeId: string | undefined;
  const address = SMOKE_WALLETS.primary.address;
  const account = privateKeyToAccount(SMOKE_WALLETS.primary.privateKey);

  // 1. profiles.me — verifies the JWT is accepted and Firestore is readable
  results.push(
    await check('profiles.me → wallet profile returned', async () => {
      if (!token) throw new Error('no JWT — auth layer failed');
      const profile = await tRPCQuery<{ address: string } | null>(cfg, 'profiles.me', null, token);
      // Profile may be null if not yet created — that's OK, just confirm the call succeeded
      const addr =
        (profile as Record<string, unknown> | null)?.address ??
        (profile as Record<string, unknown> | null)?.walletAddress ??
        address;
      return `wallet=${String(addr).slice(0, 10)}…`;
    })
  );

  // 2. universes.getAll — public, no JWT required
  results.push(
    await check('universes.getAll → list returned', async () => {
      const universes = await tRPCQuery<unknown[]>(cfg, 'universes.getAll');
      const count = Array.isArray(universes) ? universes.length : 0;
      return `${count} universe(s) in Firestore`;
    })
  );

  // 3. universes.getByCreator — public, filtered by smoke wallet
  results.push(
    await check('universes.getByCreator → query by wallet', async () => {
      const universes = await tRPCQuery<unknown[]>(cfg, 'universes.getByCreator', {
        creator: address,
      });
      const count = Array.isArray(universes) ? universes.length : 0;
      return `${count} universe(s) by smoke wallet`;
    })
  );

  // 4. universes.create — Firestore write with wallet signature + server nonce
  results.push(
    await check('universes.create → Firestore write', async () => {
      if (!token) throw new Error('no JWT — auth layer failed');
      // Fetch a fresh server-issued nonce (prevents signature replay)
      const nonceRes = await tRPCQuery<{ nonce: string }>(cfg, 'universes.getNonce', null, token);
      if (!nonceRes?.nonce) throw new Error('universes.getNonce did not return a nonce');

      const meta = sampleUniverseMeta(address);
      const message = buildUniverseCreateMessage(address, nonceRes.nonce);
      const signature = await account.signMessage({ message });

      const result = await tRPCMutate<{ id: string }>(
        cfg,
        'universes.create',
        {
          address: meta.address,
          creator: address,
          tokenAddress: meta.tokenAddress,
          governanceAddress: meta.governanceAddress,
          imageUrl: meta.imageUrl,
          description: meta.description,
          signature,
          message,
          nonce: nonceRes.nonce,
          chainId: cfg.chainId,
        },
        token
      );

      // Handler wraps the created record as { success, data: {id, ...} }.
      const r = result as { id?: string; data?: { id?: string } };
      const id = r?.id ?? r?.data?.id;
      if (!id) throw new Error(`no id in response: ${JSON.stringify(result).slice(0, 120)}`);
      universeId = id;
      return `id=${id.slice(0, 12)}…`;
    })
  );

  // 5. universes.get — read back the created universe
  if (universeId) {
    results.push(
      await check('universes.get → read-back created universe', async () => {
        const u = await tRPCQuery<unknown>(cfg, 'universes.get', { id: universeId });
        // Handler wraps response as { success, data: {...} }; tolerate either shape.
        const r = u as { description?: string; data?: { description?: string } };
        const desc = r?.description ?? r?.data?.description;
        if (!desc)
          throw new Error(`no description in response: ${JSON.stringify(u).slice(0, 120)}`);
        return desc.slice(0, 40) + '…';
      })
    );
  }

  // 6. Default `isPrivate` for monetized universe (the one we just created):
  // must be false — launchpad universes are always public.
  if (universeId) {
    results.push(
      await check('universes.get → monetized default isPrivate=false', async () => {
        const u = await tRPCQuery<unknown>(cfg, 'universes.get', { id: universeId });
        const data = (u as { data?: Record<string, unknown> })?.data ?? {};
        const isPrivate = Boolean((data as { isPrivate?: boolean }).isPrivate);
        const universeType = (data as { universeType?: string }).universeType ?? 'monetized';
        if (universeType !== 'monetized' || isPrivate !== false) {
          throw new Error(`expected monetized + isPrivate=false, got ${universeType}/${isPrivate}`);
        }
        return 'isPrivate=false ✓';
      })
    );
  }

  // 7. setPrivate on monetized universe must reject — launchpad universes are
  //    always public; flipping one private would unlist a trading token.
  if (universeId && token) {
    results.push(
      await check('universes.setPrivate → monetized rejects private', async () => {
        try {
          await tRPCMutate(cfg, 'universes.setPrivate', { universeId, isPrivate: true }, token);
          throw new Error('expected setPrivate(true) to fail on monetized universe');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/Launchpad.*always public/i.test(msg)) {
            return 'locked ✓';
          }
          throw err;
        }
      })
    );
  }

  // 8. Create a `fun` universe — must land isPrivate=true by default. Then flip
  //    to public via setPrivate(false). This exercises the Launch Publicly flow.
  let funUniverseId: string | undefined;
  if (token) {
    results.push(
      await check('universes.create (fun) → defaults isPrivate=true', async () => {
        const nonceRes = await tRPCQuery<{ nonce: string }>(cfg, 'universes.getNonce', null, token);
        if (!nonceRes?.nonce) throw new Error('universes.getNonce did not return a nonce');

        const meta = sampleUniverseMeta(address);
        const message = buildUniverseCreateMessage(address, nonceRes.nonce);
        const signature = await account.signMessage({ message });

        const result = await tRPCMutate<{ id?: string; data?: { id?: string } }>(
          cfg,
          'universes.create',
          {
            address: meta.address,
            creator: address,
            tokenAddress: meta.tokenAddress,
            governanceAddress: meta.governanceAddress,
            imageUrl: meta.imageUrl,
            description: meta.description,
            signature,
            message,
            nonce: nonceRes.nonce,
            chainId: cfg.chainId,
            universeType: 'fun',
          },
          token
        );
        funUniverseId = result?.id ?? result?.data?.id;
        if (!funUniverseId) throw new Error('no id returned from fun universe create');

        // Fun universes default to isPrivate=true — the get handler gates
        // private universes to the owner, so we must pass the smoke-wallet
        // JWT to see our own newly-created private universe.
        const u = await tRPCQuery<{ data?: Record<string, unknown> }>(
          cfg,
          'universes.get',
          { id: funUniverseId },
          token
        );
        const data = u?.data ?? {};
        if ((data as { universeType?: string }).universeType !== 'fun') {
          throw new Error(`expected universeType=fun, got ${JSON.stringify(data).slice(0, 80)}`);
        }
        if ((data as { isPrivate?: boolean }).isPrivate !== true) {
          throw new Error(`expected isPrivate=true for fun universe`);
        }
        return `fun id=${funUniverseId.slice(0, 12)}…`;
      })
    );

    if (funUniverseId) {
      results.push(
        await check('universes.setPrivate (fun, false) → Launch Publicly succeeds', async () => {
          await tRPCMutate(
            cfg,
            'universes.setPrivate',
            { universeId: funUniverseId, isPrivate: false },
            token
          );
          const u = await tRPCQuery<{ data?: Record<string, unknown> }>(cfg, 'universes.get', {
            id: funUniverseId,
          });
          const isPrivate = Boolean((u?.data as { isPrivate?: boolean } | undefined)?.isPrivate);
          if (isPrivate) throw new Error('setPrivate(false) did not take effect');
          return 'now public ✓';
        })
      );
    }
  }

  // 9. episodes.publishAsCanon — router registration probe (no real episode
  //    exists, NOT_FOUND is the expected response).
  if (token) {
    results.push(
      await check('episodes.publishAsCanon → registered', async () => {
        try {
          await tRPCMutate(
            cfg,
            'episodes.publishAsCanon',
            { episodeId: 'smoke-nonexistent-episode' },
            token
          );
          throw new Error('expected NOT_FOUND for nonexistent episode');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/No procedure found on path/.test(msg)) {
            throw new Error('ROUTER NOT REGISTERED: episodes.publishAsCanon');
          }
          if (/NOT_FOUND/i.test(msg) || /not found/i.test(msg)) {
            return 'expected:NOT_FOUND ✓';
          }
          throw err;
        }
      })
    );
  }

  // 10. episodes.list — public call must return only canon episodes. We can't
  //     assert on a specific count without seeded data, but we can verify the
  //     call succeeds and every returned episode has isCanon=true (drafts must
  //     be filtered out for anonymous viewers).
  if (universeId) {
    results.push(
      await check('episodes.list (public) → canon-only filter', async () => {
        const episodes = await tRPCQuery<
          Array<{ isCanon?: boolean }> | { data?: Array<{ isCanon?: boolean }> }
        >(cfg, 'episodes.list', { universeId, limit: 20 });
        const arr = Array.isArray(episodes)
          ? episodes
          : ((episodes as { data?: Array<{ isCanon?: boolean }> }).data ?? []);
        const nonCanon = arr.filter((e) => e.isCanon === false);
        if (nonCanon.length > 0) {
          throw new Error(`public list returned ${nonCanon.length} draft(s)`);
        }
        return `${arr.length} canon episode(s)`;
      })
    );
  }

  return { universeId, checks: results };
}
