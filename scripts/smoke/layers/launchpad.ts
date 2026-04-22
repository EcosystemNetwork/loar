/**
 * Layer — launchpad
 * ─────────────────────────────────────────────────────────────────────────────
 * Read-only checks for the launchpad surface (LaunchpadStaking + bonding-curve
 * indexer + server tier sync). Confirms each layer is reachable and consistent
 * without spending gas:
 *
 *   1. LaunchpadStaking contract deployed + tier configs readable
 *   2. New post-LS-1 hardening surfaces are present (distributors mapping,
 *      distribution guard fields)
 *   3. Server `/staking.tiers` returns tier list (chain-derived if available)
 *   4. Indexer schema includes the new bondingCurve hardening tables
 *      (bondingCurveSnapshot, bondingCurveRefund, bondingCurveHaltEvent)
 *   5. (optional) If SMOKE_BONDING_CURVE is set, read its trading status +
 *      pendingHalt slot to verify the new BondingCurve halt-timelock surface
 *
 * Identifies: stale ABI, missing post-upgrade init, indexer schema drift,
 *             server/contract tier desync.
 */
import { createPublicClient, http, parseAbi, getAddress } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import type { SmokeConfig } from '../config.ts';
import { check, skipped, type CheckResult } from '../reporter.ts';
import { LaunchpadStaking as LaunchpadStakingAddresses } from '../../../packages/abis/src/addresses.ts';

const CHAINS: Record<number, typeof sepolia> = {
  [sepolia.id]: sepolia,
  [baseSepolia.id]: baseSepolia,
};

// Minimal ABI covering the surfaces the smoke needs to assert.
const STAKING_ABI = parseAbi([
  'function tierConfigs(uint8) view returns (uint256 minStake, uint16 weight, uint16 feeDiscountBps, uint16 curationBoost, bool priorityQueue)',
  'function distributors(address) view returns (bool)',
  'function minDistributionInterval() view returns (uint256)',
  'function maxRewardBpsPerDistribution() view returns (uint16)',
  'function totalStaked() view returns (uint256)',
  'function owner() view returns (address)',
]);

const BONDING_CURVE_ABI = parseAbi([
  'function tradingHalted() view returns (bool)',
  'function graduated() view returns (bool)',
  'function emergencyHaltUsed() view returns (bool)',
  'function HALT_TIMELOCK() view returns (uint256)',
  'function pendingHalt() view returns (bool pending, bool halted, uint64 executeAfter)',
  'function totalPendingRefunds() view returns (uint256)',
]);

const TIER_NAMES = ['NONE', 'BRONZE', 'SILVER', 'GOLD', 'DIAMOND'] as const;

export interface LaunchpadResult {
  checks: CheckResult[];
}

export async function runLaunchpadLayer(cfg: SmokeConfig, jwt: string): Promise<LaunchpadResult> {
  const results: CheckResult[] = [];
  const chain = CHAINS[cfg.chainId] ?? sepolia;
  const stakingAddress = (LaunchpadStakingAddresses as Record<string, string>)[String(cfg.chainId)];

  if (!stakingAddress) {
    results.push(
      skipped(
        'LaunchpadStaking contract',
        `no LaunchpadStaking address registered for chain ${cfg.chainId} in packages/abis/src/addresses.ts`
      )
    );
  } else {
    const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
    const stakingAddr = getAddress(stakingAddress);

    // 1. Contract deployed
    results.push(
      await check('LaunchpadStaking contract deployed', async () => {
        const code = await publicClient.getCode({ address: stakingAddr });
        if (!code || code === '0x') {
          throw new Error(`no code at ${stakingAddr}`);
        }
        return `${stakingAddr.slice(0, 10)}…`;
      })
    );

    // 2. Tier configs readable + sane (BRONZE < SILVER < GOLD < DIAMOND)
    results.push(
      await check('LaunchpadStaking.tierConfigs() monotonic thresholds', async () => {
        const reads = await Promise.all(
          [1, 2, 3, 4].map((tier) =>
            publicClient.readContract({
              address: stakingAddr,
              abi: STAKING_ABI,
              functionName: 'tierConfigs',
              args: [tier],
            })
          )
        );
        const mins = reads.map((r) => Number(r[0]) / 1e18);
        for (let i = 1; i < mins.length; i++) {
          if (mins[i] < mins[i - 1]) {
            throw new Error(
              `non-monotonic: ${TIER_NAMES[i + 1]}=${mins[i]} < ${TIER_NAMES[i]}=${mins[i - 1]}`
            );
          }
        }
        return `BRONZE=${mins[0]} SILVER=${mins[1]} GOLD=${mins[2]} DIAMOND=${mins[3]}`;
      })
    );

    // 3. Post-LS-1 hardening surface: distributionGuard fields present.
    //    If both are 0 the V2 init has NOT run yet — surface that as a
    //    soft warning (success with caveat) rather than a hard fail.
    results.push(
      await check('LaunchpadStaking distribution-guard surface present', async () => {
        const [interval, capBps] = await Promise.all([
          publicClient.readContract({
            address: stakingAddr,
            abi: STAKING_ABI,
            functionName: 'minDistributionInterval',
          }),
          publicClient.readContract({
            address: stakingAddr,
            abi: STAKING_ABI,
            functionName: 'maxRewardBpsPerDistribution',
          }),
        ]);
        const intervalNum = Number(interval);
        const capNum = Number(capBps);
        if (intervalNum === 0 && capNum === 0) {
          return `surface ok, defaults UNSET — call initializeDistributionGuardV2 to enable`;
        }
        return `interval=${intervalNum} blocks, cap=${capNum} bps`;
      })
    );

    // 4. Owner readable (should not be 0x0)
    results.push(
      await check('LaunchpadStaking.owner() set', async () => {
        const owner = await publicClient.readContract({
          address: stakingAddr,
          abi: STAKING_ABI,
          functionName: 'owner',
        });
        if (owner === '0x0000000000000000000000000000000000000000') {
          throw new Error('owner is zero address');
        }
        return `owner=${String(owner).slice(0, 10)}…`;
      })
    );
  }

  // NOTE: staking router was removed in commit 595c5ccb ("remove workflow
  // feature set and integrate OAuth verification helper"). Tier configs are
  // read directly from LaunchpadStaking on-chain above; there is no server
  // staking.tiers endpoint. If the router is reinstated, re-add a check here.

  // 6. Indexer schema — confirm new launchpad tables are present.
  //    Probes the GraphQL schema introspection rather than running a query
  //    so the check still passes when the indexer has zero rows.
  results.push(
    await check('indexer schema has bondingCurveSnapshot/Refund/HaltEvent', async () => {
      const url = `${cfg.indexerUrl}/graphql`;
      const query = {
        query: `{
          __schema {
            types {
              name
            }
          }
        }`,
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
        signal: AbortSignal.timeout(cfg.timeout),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: any = await res.json();
      const types: string[] = json?.data?.__schema?.types?.map((t: any) => t.name) ?? [];
      const required = ['bondingCurveSnapshot', 'bondingCurveRefund', 'bondingCurveHaltEvent'];
      const missing = required.filter((r) => !types.includes(r));
      if (missing.length > 0) {
        throw new Error(
          `missing tables: ${missing.join(', ')} — re-run indexer with updated schema`
        );
      }
      return `present: ${required.join(', ')}`;
    })
  );

  // 7. Optional: BondingCurve halt-timelock surface
  const bondingCurveAddress = process.env.SMOKE_BONDING_CURVE as `0x${string}` | undefined;
  if (bondingCurveAddress) {
    const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
    results.push(
      await check(
        `BondingCurve(${bondingCurveAddress.slice(0, 10)}…) halt-timelock surface`,
        async () => {
          const [halted, graduated, emergencyUsed, timelock, pending, pendingRefunds] =
            await Promise.all([
              publicClient.readContract({
                address: bondingCurveAddress,
                abi: BONDING_CURVE_ABI,
                functionName: 'tradingHalted',
              }),
              publicClient.readContract({
                address: bondingCurveAddress,
                abi: BONDING_CURVE_ABI,
                functionName: 'graduated',
              }),
              publicClient.readContract({
                address: bondingCurveAddress,
                abi: BONDING_CURVE_ABI,
                functionName: 'emergencyHaltUsed',
              }),
              publicClient.readContract({
                address: bondingCurveAddress,
                abi: BONDING_CURVE_ABI,
                functionName: 'HALT_TIMELOCK',
              }),
              publicClient.readContract({
                address: bondingCurveAddress,
                abi: BONDING_CURVE_ABI,
                functionName: 'pendingHalt',
              }),
              publicClient.readContract({
                address: bondingCurveAddress,
                abi: BONDING_CURVE_ABI,
                functionName: 'totalPendingRefunds',
              }),
            ]);
          if (Number(timelock) !== 48 * 3600) {
            throw new Error(`HALT_TIMELOCK=${timelock}s, expected 172800s (48h)`);
          }
          return `halted=${halted} graduated=${graduated} emergencyUsed=${emergencyUsed} pendingHalt.pending=${pending[0]} pendingRefunds=${pendingRefunds}`;
        }
      )
    );
  } else {
    results.push(
      skipped(
        'BondingCurve halt-timelock surface',
        'set SMOKE_BONDING_CURVE=0x… to a deployed curve to enable'
      )
    );
  }

  return { checks: results };
}
