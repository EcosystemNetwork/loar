/**
 * Renders the real `<ReactFlow>` canvas on top of `useUniverseBlockchain`'s
 * output to prove — in the DOM, not just in hook state — that a universe's
 * nodes end up rendered on screen and *stay* there.
 *
 * NO MOCKS. This is a real-stack test against the actual reported universe:
 *  - wagmi reads the real "Cyber War" Universe contract
 *    (0x341ffa19c0ec8d2c8ef42a360cf799949844262e) over the real public
 *    Sepolia RPC, via the app's own wagmi `config` (apps/web/config.ts).
 *  - `nodeMedia.list` goes through the real tRPC client to a real running
 *    `apps/server`, backed by a real Firestore emulator seeded with the
 *    exact hidden-override state captured from production on 2026-09-19
 *    (102 of 116 nodes hidden by `script:hide-cyber-war-broken`, leaving
 *    nodes 21-34 visible).
 *  - `nodeContents` goes through the real Ponder indexer at
 *    https://idx.loar.fun (production, read-only).
 *
 * Prereq (same shape as apps/server's own real-stack tests) — NOT run by
 * default `pnpm test:unit` / CI, same opt-in convention as
 * `test:e2e:real` (see playwright.real.config.ts's header):
 *   firebase emulators:start --only firestore --project loar-db &
 *   pnpm -F server exec tsx scripts/seed-cyber-war-media-overrides.ts
 *   pnpm -F server exec tsx src/index.ts   # (or `make dev-server`)
 *
 * Without that local server reachable, this file's tests skip themselves
 * (with a console note) rather than fail — a CI run with no stack up is not
 * a regression. The deterministic version of the actual bug's regression
 * test, which *does* run in default CI, lives in
 * useUniverseBlockchain.mediaOverrideRace.test.tsx.
 *
 * Root cause under test: `nodeMedia.list`'s loading state used to be
 * dropped on the floor (only its `data` was read), so the on-chain graph —
 * fast, a single `getFullGraph()` call — rendered all 116 nodes before the
 * overrides were known, then the overrides resolved and 102 of them
 * vanished. Reported live as "nodes pop up and disappear seconds later".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import ReactFlow from 'reactflow';
import 'reactflow/dist/style.css';
import { config } from '@/../config';

afterEach(() => {
  vi.unstubAllEnvs();
});

const LOCAL_SERVER_URL = 'http://localhost:3000';

/** True when the real local server (and thus, transitively, the Firestore
 * emulator behind it) is actually reachable. Checked once at collection
 * time via top-level await — vitest supports this in ESM test files — so
 * the whole describe block below can self-skip instead of hanging or
 * failing when the prereq stack (see file header) hasn't been started. */
async function isLocalServerUp(): Promise<boolean> {
  try {
    const res = await fetch(LOCAL_SERVER_URL, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}
const LOCAL_SERVER_UP = await isLocalServerUp();
if (!LOCAL_SERVER_UP) {
  // eslint-disable-next-line no-console
  console.warn(
    `[universeCanvasNodesOnScreen.test.tsx] ${LOCAL_SERVER_URL} unreachable — skipping ` +
      "real-stack test. See this file's header for how to start the prereq stack."
  );
}

const CONTRACT_ADDRESS = '0x341ffa19c0ec8d2c8ef42a360cf799949844262e';
// The real, current visible set for this universe (see seed script / the
// production nodeMediaOverrides audit this test's header describes).
const EXPECTED_VISIBLE_IDS = Array.from({ length: 14 }, (_, i) => String(21 + i)); // ['21', ..., '34']

/** Same graphData → ReactFlow `nodes` prop wiring routes/universe/$id.tsx does. */
function makeTimelineCanvas(
  useUniverseBlockchain: typeof import('../useUniverseBlockchain').useUniverseBlockchain
) {
  return function TimelineCanvas() {
    const { graphData, isLoadingAny } = useUniverseBlockchain({
      universeId: CONTRACT_ADDRESS,
      contractAddress: CONTRACT_ADDRESS,
      isBlockchainUniverse: true,
      isOnChain: true,
    });

    if (isLoadingAny) return <div data-testid="loading">Loading universe timeline…</div>;

    const nodes = graphData.nodeIds.map((id, i) => ({
      id: String(id),
      position: { x: (i % 10) * 150, y: Math.floor(i / 10) * 120 },
      data: { label: `Node ${id}` },
    }));

    return (
      <div style={{ width: 1600, height: 800 }} data-testid="canvas">
        <ReactFlow nodes={nodes} edges={[]} />
      </div>
    );
  };
}

describe.skipIf(!LOCAL_SERVER_UP)(
  'universe timeline canvas — nodes stay on screen (real stack)',
  () => {
    it('the real Cyber War universe settles to exactly its 14 real visible nodes and keeps them on screen', async () => {
      // Real local server (real tRPC → real Firestore-emulator-backed
      // nodeMedia/offChainNodes routers) and the real production Ponder
      // indexer. Must be stubbed before useUniverseBlockchain (and the
      // trpc/ponder-api modules it imports) are first evaluated, hence the
      // dynamic import below instead of a static one.
      vi.stubEnv('VITE_SERVER_URL', 'http://localhost:3000');
      vi.stubEnv('VITE_PONDER_URL', 'https://idx.loar.fun');

      const { useUniverseBlockchain } = await import('../useUniverseBlockchain');
      const TimelineCanvas = makeTimelineCanvas(useUniverseBlockchain);

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <WagmiProvider config={config}>
          <QueryClientProvider client={queryClient}>
            <TimelineCanvas />
          </QueryClientProvider>
        </WagmiProvider>
      );

      // Real Sepolia RPC + real localhost server + real production indexer —
      // give this real round trips room, but it should land well inside it.
      await waitFor(() => expect(screen.queryByTestId('canvas')).toBeInTheDocument(), {
        timeout: 20_000,
      });
      await waitFor(() => expect(document.querySelectorAll('.react-flow__node').length).toBe(14), {
        timeout: 20_000,
      });

      const onScreenIds = Array.from(document.querySelectorAll('.react-flow__node'))
        .map((el) => el.getAttribute('data-id'))
        .sort((a, b) => Number(a) - Number(b));
      // eslint-disable-next-line no-console
      console.log('[real stack] nodes on screen:', onScreenIds);
      for (const id of onScreenIds) {
        // eslint-disable-next-line no-console
        console.log(
          '  ->',
          within(document.querySelector(`[data-id="${id}"]`)!).getByText(`Node ${id}`).textContent
        );
      }

      expect(onScreenIds).toEqual(EXPECTED_VISIBLE_IDS);

      // And they stay — the real overrides fetch has already settled by now,
      // so nothing should come along later and shrink the set further (the
      // pre-fix bug: a second, later-arriving filter pass).
      await new Promise((r) => setTimeout(r, 200));
      const stillOnScreenIds = Array.from(document.querySelectorAll('.react-flow__node'))
        .map((el) => el.getAttribute('data-id'))
        .sort((a, b) => Number(a) - Number(b));
      // eslint-disable-next-line no-console
      console.log('[real stack, 200ms later] nodes still on screen:', stillOnScreenIds);
      expect(stillOnScreenIds).toEqual(EXPECTED_VISIBLE_IDS);
    }, 30_000);

    // NOT tested here: catching the actual race window (isLoadingAny false
    // while graphData still holds the un-filtered 116). Tried it against this
    // real stack first — recorded every render's (isLoadingAny, nodeCount)
    // pair the same way, asserted none of them were inconsistent. It passed,
    // including with the useUniverseBlockchain.ts fix reverted by hand: local
    // infra (localhost server, direct RPC) resolves the on-chain graph and the
    // override fetch close enough together that the bad intermediate state
    // isn't reliably observable, so that version of the test gave false
    // confidence — it couldn't fail even when the bug was back. Production's
    // uneven real-network latency is what actually opens the window. The
    // timing-precise regression test stays deterministic and mocked, in
    // useUniverseBlockchain.mediaOverrideRace.test.tsx, which controls exactly
    // when the override fetch resolves relative to the graph fetch.
  }
);
