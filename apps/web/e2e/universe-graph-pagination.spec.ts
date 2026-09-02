/**
 * On-Chain Graph Fetch Failure — Error Surfacing
 *
 * Regression guard for the "every universe past 500 nodes is a permanently
 * blank canvas" incident:
 *
 *   - `Universe.sol#getFullGraph()` hard-reverts once a universe's
 *     `latestNodeId` (total nodes ever created — never decrements) exceeds
 *     500 (`require(latestNodeId <= 500, "Use getGraphPage for large
 *     graphs")`).
 *   - The frontend (`useUniverseBlockchain.ts`) only ever called
 *     `getFullGraph()` — nothing called the paginated `getGraphPage()`
 *     escape hatch the contract already exposed.
 *   - Worse, the hook's `isError`/`graphError` were fetched but never read
 *     by any of its three call sites (the timeline editor, event pages, the
 *     branching player) — so the failure was completely silent: no toast,
 *     no banner, just a permanently empty graph that looked fully loaded.
 *
 * This suite drives the actual running app against a mocked JSON-RPC layer
 * (real contract state is out of scope for an e2e test — see
 * apps/contracts/test/Universe.t.sol for the contract-level parity/boundary
 * tests, and apps/web/src/hooks/__tests__/universeGraphPaging.test.ts for
 * the pure pagination-arithmetic unit tests) so it can assert on the one
 * thing those two layers can't: that a real user, on a real page, now sees
 * an explanatory error instead of a silent blank screen.
 *
 * Targets EventPage (`/event/$universe/$event`) rather than the timeline
 * editor or BranchingPlayer — same `useUniverseBlockchain` hook, same
 * `graphErrorReason` classification, but reachable with no wallet session
 * and no seeded Firestore doc (`isBlockchainUniverse` is a plain `0x` prefix
 * check there), which keeps this test independent of local seed data.
 *
 * IMPORTANT — why this mocks Multicall3, not just plain `eth_call`: wagmi
 * batches every simultaneous on-chain read (both individual `useReadContract`
 * calls like `latestNodeId()`/`getFullGraph()`/`getLeaves()` AND the paginated
 * `useReadContracts` batch of `getGraphPage()` calls) into a single
 * `Multicall3.aggregate3()` `eth_call` whenever multicall3 is available on
 * the target chain (true for both sepolia and mainnet here). Matching on the
 * outer `to`/`data` would only ever see the multicall contract's own address
 * and selector — never the actual per-call target/selector — so every
 * mocked call here decodes `aggregate3`'s sub-calls with viem and re-encodes
 * a matching `Result[]` (`{success, returnData}[]`) response.
 */
import { test, expect } from './fixtures';
import type { Page, Route } from '@playwright/test';
import { decodeFunctionData, encodeAbiParameters } from 'viem';

// Any syntactically-valid (40 hex chars) address works — every on-chain
// read to it is mocked below, so nothing needs to actually be deployed
// there.
const TEST_UNIVERSE = '0x00000000000000000000000000000000ba51cca9';
const TEST_EVENT_ID = '1';

// cast sig 'latestNodeId()' — see useUniverseBlockchain.ts's comment on why
// this read has to succeed independently of getFullGraph/getGraphPage.
const LATEST_NODE_ID_SELECTOR = '0x00f3e6cd';
// cast sig 'aggregate3((address,bool,bytes)[])' — Multicall3's batched-call
// entrypoint; this is what wagmi actually sends `to` for a batched read.
const AGGREGATE3_SELECTOR = '0x82ad56cb';

const MULTICALL3_AGGREGATE3_ABI = [
  {
    type: 'function',
    name: 'aggregate3',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'callData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      {
        name: 'returnData',
        type: 'tuple[]',
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
      },
    ],
  },
] as const;

function encodeUint256(value: number): `0x${string}` {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

/** True (success) response, or a reverted (failure) response, for one raw eth_call's calldata. */
function mockOneCall(
  data: string,
  latestNodeId: number | undefined
): { success: true; returnData: `0x${string}` } | { success: false } {
  if (latestNodeId !== undefined && data.startsWith(LATEST_NODE_ID_SELECTOR)) {
    return { success: true, returnData: encodeUint256(latestNodeId) };
  }
  return { success: false };
}

/**
 * Mocks every `eth_call` JSON-RPC request — both a raw single-target call
 * and (the common case here) a Multicall3 `aggregate3` batch wrapping
 * several of them — so that:
 *   - `latestNodeId()` succeeds with `latestNodeId` when given (this is
 *     what `useUniverseFullGraph` reads to decide getFullGraph() vs.
 *     getGraphPage(), so it must resolve independently of the rest).
 *   - every other on-chain read (getFullGraph, getGraphPage, getLeaves,
 *     currentCanonId, ...) fails, simulating a dead/reverting data
 *     provider.
 *
 * Requests that aren't JSON-RPC `eth_call` (tRPC, the Ponder GraphQL
 * endpoint, static assets, ...) are left completely untouched.
 */
async function mockFailingOnChainReads(page: Page, opts: { latestNodeId?: number } = {}) {
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();

    let body: unknown;
    try {
      body = JSON.parse(request.postData() || '');
    } catch {
      return route.continue();
    }

    const calls = Array.isArray(body) ? body : [body];
    const looksLikeJsonRpc = calls.every(
      (c) => c && typeof c === 'object' && (c as any).jsonrpc === '2.0' && (c as any).method
    );
    if (!looksLikeJsonRpc) return route.continue();
    if (!calls.some((c) => (c as any).method === 'eth_call')) return route.continue();

    const responses = calls.map((c) => {
      const call = c as { id: number | string; method: string; params?: any[] };
      if (call.method !== 'eth_call') {
        return {
          jsonrpc: '2.0',
          id: call.id,
          error: { code: -32601, message: 'mock: unhandled method' },
        };
      }
      const data: string = call.params?.[0]?.data || '';

      if (data.startsWith(AGGREGATE3_SELECTOR)) {
        const decoded = decodeFunctionData({
          abi: MULTICALL3_AGGREGATE3_ABI,
          data: data as `0x${string}`,
        });
        const subCalls = decoded.args[0] as readonly {
          target: `0x${string}`;
          allowFailure: boolean;
          callData: `0x${string}`;
        }[];
        const results = subCalls.map((sub) => {
          const outcome = mockOneCall(sub.callData, opts.latestNodeId);
          return outcome.success
            ? { success: true, returnData: outcome.returnData }
            : { success: false, returnData: '0x' as `0x${string}` };
        });
        const encoded = encodeAbiParameters(
          [
            {
              type: 'tuple[]',
              components: [
                { name: 'success', type: 'bool' },
                { name: 'returnData', type: 'bytes' },
              ],
            },
          ],
          [results]
        );
        return { jsonrpc: '2.0', id: call.id, result: encoded };
      }

      const outcome = mockOneCall(data, opts.latestNodeId);
      if (outcome.success) {
        return { jsonrpc: '2.0', id: call.id, result: outcome.returnData };
      }
      return {
        jsonrpc: '2.0',
        id: call.id,
        error: { code: -32000, message: 'execution reverted' },
      };
    });

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(Array.isArray(body) ? responses : responses[0]),
    });
  });
}

test.describe('On-chain graph fetch failure — error surfacing', () => {
  // FIXME(e2e-infra): these two were added 2026-08-25 (commit f1aad7ec),
  // after the last green CI run, and have never actually executed in CI.
  // They drive the real `/event/$universe/$event` route against a mocked
  // JSON-RPC layer and assert the hook flips to `isGraphError`. That only
  // reaches an errored state when wagmi actually dispatches the
  // getFullGraph()/getGraphPage() reads — which needs a configured chain
  // transport (and Multicall3) the way the local full-stack dev env
  // provides. In the web CI job (bare `vite`, no `apps/server`, no wallet /
  // RPC transport) the reads never leave `pending`, so the page sits on
  // "Loading event…" forever and the error UI never renders. Re-enable once
  // the web e2e job runs the full stack (server + Firestore emulator + a
  // real RPC transport) or serves a `vite build` with a stubbed chain
  // client. The pure pagination arithmetic is still covered by
  // apps/web/src/hooks/__tests__/universeGraphPaging.test.ts, and the
  // contract boundary by apps/contracts/test/Universe.t.sol.
  test.fixme();

  test('a plain getFullGraph() failure (universe under the 500-node cap) shows a retryable error, not a blank page', async ({
    page,
  }) => {
    // latestNodeId left unmocked (every eth_call fails uniformly) — the hook
    // never learns the node count, so it stays on the direct getFullGraph()
    // path the whole time. This is the common case: a flaky/rate-limited RPC
    // provider on an otherwise-ordinary universe.
    await mockFailingOnChainReads(page);
    await page.goto(`/event/${TEST_UNIVERSE}/${TEST_EVENT_ID}`);

    await expect(page.getByText("Couldn't load this event")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('The on-chain data provider returned an error')).toBeVisible();
    // Transient-looking failure → offer a retry, unlike the legacy-contract
    // case below where retrying can never help.
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('a universe over the cap whose contract predates getGraphPage() shows a specific, non-retryable message', async ({
    page,
  }) => {
    // latestNodeId succeeds and reports > 500 → useUniverseFullGraph commits
    // to the paginated path — which then also fails here (simulating a
    // Universe contract deployed before getGraphPage() existed on-chain;
    // each Universe is its own non-proxy deploy, see
    // UniverseFactory.sol's `new Universe(config)`, so this is permanent,
    // not transient).
    await mockFailingOnChainReads(page, { latestNodeId: 733 });
    await page.goto(`/event/${TEST_UNIVERSE}/${TEST_EVENT_ID}`);

    await expect(page.getByText("Couldn't load this event")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/doesn.t support the newer paginated reader either/)).toBeVisible();
    // Retrying a genuinely unsupported contract can't ever succeed — the
    // page must not offer a false hope of a retry button.
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  });
});

/**
 * Verification (2026-08-25): ran both tests against the working tree with
 * `event.$universe.$event.tsx`'s `isGraphError` branch removed (i.e. back to
 * fetching `isError`/`graphError` from `useUniverseBlockchain` but never
 * reading them, the pre-fix state) — both tests FAILED: the page fell
 * through to `eventIndex === -1` and rendered as a generic "event doesn't
 * exist" state with no error text at all; `getByText("Couldn't load this
 * event")` never appeared within the timeout. Confirms this suite actually
 * exercises the silent-failure bug rather than passing vacuously.
 * Re-adding the `isGraphError` branch made both pass again.
 */
