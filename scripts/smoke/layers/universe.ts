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

  // 4. universes.create — Firestore write with wallet signature
  results.push(
    await check('universes.create → Firestore write', async () => {
      const meta = sampleUniverseMeta(address);
      const message = buildUniverseCreateMessage(address);
      const signature = await account.signMessage({ message });

      const result = await tRPCMutate<{ id: string }>(cfg, 'universes.create', {
        address: meta.address,
        creator: address,
        tokenAddress: meta.tokenAddress,
        governanceAddress: meta.governanceAddress,
        imageUrl: meta.imageUrl,
        description: meta.description,
        signature,
        message,
      });

      const id = (result as Record<string, unknown>)?.id as string | undefined;
      if (!id) throw new Error(`no id in response: ${JSON.stringify(result).slice(0, 120)}`);
      universeId = id;
      return `id=${id.slice(0, 12)}…`;
    })
  );

  // 5. universes.get — read back the created universe
  if (universeId) {
    results.push(
      await check('universes.get → read-back created universe', async () => {
        const u = await tRPCQuery<{ id: string; description: string }>(cfg, 'universes.get', {
          id: universeId,
        });
        const desc = (u as Record<string, unknown>)?.description as string | undefined;
        if (!desc)
          throw new Error(`no description in response: ${JSON.stringify(u).slice(0, 120)}`);
        return desc.slice(0, 40) + '…';
      })
    );
  }

  return { universeId, checks: results };
}
