/**
 * Console-only diagnostics for the universe editor's media pipeline.
 *
 * Walks every node's resolved media URL, computes the same gateway
 * candidate chain the real render path uses (getIpfsUrlCandidates /
 * resolveIpfsUrlAsync from ipfs-url.ts), and actually probes each
 * candidate so a "content failed to load" report can be diagnosed from a
 * pasted console log instead of a live repro session. Auto-runs from
 * $id.tsx in dev builds; callable manually anywhere via
 * `window.__loarIpfsDiag()` (also exposed in prod for on-demand use).
 */
import type { GraphData } from '@/hooks/universeGraphData';
import { getIpfsGatewayDebugInfo, getIpfsUrlCandidates, resolveIpfsUrlAsync } from './ipfs-url';

interface CandidateResult {
  url: string;
  ok: boolean;
  status: number | null;
  ms: number;
  error: string | null;
}

interface NodeDiagnostic {
  nodeId: string;
  title: string;
  hasMedia: boolean;
  dedicatedResolveMs: number | null;
  dedicatedResolveUrl: string | null;
  candidates: CandidateResult[];
  allFailed: boolean;
}

// Real universes can have hundreds of nodes; probing all of them on every
// load would itself contribute to gateway rate-limiting. Cap it — the
// point is a representative sample, not exhaustive coverage.
const MAX_NODES_PROBED = 60;
const PROBE_TIMEOUT_MS = 8000;

async function probeCandidate(url: string): Promise<CandidateResult> {
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'HEAD', mode: 'cors', signal: controller.signal });
    return {
      url,
      ok: res.ok,
      status: res.status,
      ms: Math.round(performance.now() - start),
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    return {
      url,
      ok: false,
      status: null,
      ms: Math.round(performance.now() - start),
      error: isAbort ? `timeout >${PROBE_TIMEOUT_MS}ms` : String((err as Error)?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

// Skip re-running the (expensive, network-heavy) full probe when nothing
// about the graph actually changed — $id.tsx's effect fires on every
// `graphData` reference change, which includes unrelated re-renders.
let lastRunKey = '';

export async function runIpfsNodeDiagnostics(
  graphData: GraphData,
  universeId: string,
  opts: { force?: boolean } = {}
): Promise<void> {
  const runKey = `${universeId}:${graphData.nodeIds.length}:${graphData.urls.join('|').slice(0, 1000)}`;
  if (!opts.force && runKey === lastRunKey) return;
  lastRunKey = runKey;

  const env = getIpfsGatewayDebugInfo();
  const total = graphData.nodeIds.length;
  const withMedia = graphData.urls.filter(Boolean).length;
  const truncated = total > MAX_NODES_PROBED;

  console.log(
    '%c[LOAR IPFS DIAGNOSTICS] universe=%s nodes=%d withMedia=%d%s',
    'font-weight:bold;color:#7c3aed',
    universeId,
    total,
    withMedia,
    truncated ? ` (probing first ${MAX_NODES_PROBED} only)` : ''
  );
  console.log(
    `  env: serverUrl=${env.serverUrl ?? 'NONE'} dedicated=${
      env.dedicatedConfigured
        ? `${env.dedicatedHost} (token=${env.dedicatedHasToken})`
        : 'NOT PRIMED'
    } activeGateway=${env.activeGateway} preferPublic=${env.preferPublic}`
  );
  if (!env.serverUrl) {
    console.warn(
      '[LOAR IPFS DIAGNOSTICS] VITE_SERVER_URL is unset in this build — the dedicated Pinata gateway ' +
        'is unreachable (primeIpfsGatewayConfig no-ops without it), so every node falls back to public ' +
        'IPFS gateways only. If this is local dev, set VITE_SERVER_URL in apps/web/.env to point at a ' +
        'running server to test the real dual-gateway path.'
    );
  }

  const results: NodeDiagnostic[] = [];
  const nodeCount = Math.min(total, MAX_NODES_PROBED);

  for (let i = 0; i < nodeCount; i++) {
    const nodeId = String(graphData.nodeIds[i]);
    const url = graphData.urls[i] || '';
    const title = graphData.descriptions[i] || '';

    if (!url) {
      results.push({
        nodeId,
        title,
        hasMedia: false,
        dedicatedResolveMs: null,
        dedicatedResolveUrl: null,
        candidates: [],
        allFailed: false,
      });
      continue;
    }

    const candidates = getIpfsUrlCandidates(url);
    const dedicatedStart = performance.now();
    let dedicatedResolveUrl: string | null = null;
    try {
      dedicatedResolveUrl = await resolveIpfsUrlAsync(url);
    } catch {
      /* left null — reported as a failed dedicated resolve below */
    }
    const dedicatedResolveMs = Math.round(performance.now() - dedicatedStart);

    const candidateResults = await Promise.all(candidates.map(probeCandidate));
    const allFailed = candidateResults.length > 0 && candidateResults.every((c) => !c.ok);

    results.push({
      nodeId,
      title,
      hasMedia: true,
      dedicatedResolveMs,
      dedicatedResolveUrl,
      candidates: candidateResults,
      allFailed,
    });
  }

  const noMedia = results.filter((r) => !r.hasMedia);
  const broken = results.filter((r) => r.hasMedia && r.allFailed);
  const ok = results.filter((r) => r.hasMedia && !r.allFailed);

  console.log(
    `  summary: ${ok.length} ok, ${broken.length} ALL-CANDIDATES-FAILED, ${noMedia.length} no-media-yet`
  );

  console.groupCollapsed('[LOAR IPFS DIAGNOSTICS] full table (click to expand)');
  console.table(
    results.map((r) => ({
      nodeId: r.nodeId,
      title: r.title.slice(0, 40),
      hasMedia: r.hasMedia,
      status: !r.hasMedia ? 'no-media' : r.allFailed ? 'ALL FAILED' : 'ok',
      dedicatedResolveMs: r.dedicatedResolveMs,
      firstOkCandidate: r.candidates.find((c) => c.ok)?.url ?? '',
      candidateCount: r.candidates.length,
    }))
  );
  console.groupEnd();

  // Plain-text block, deliberately not console.table — meant to be
  // select-all-copy-pasted verbatim into a bug report.
  const lines: string[] = [];
  lines.push(`=== LOAR IPFS DIAGNOSTICS — universe ${universeId} ===`);
  lines.push(
    `env: serverUrl=${env.serverUrl ?? 'NONE'} dedicated=${
      env.dedicatedConfigured ? env.dedicatedHost : 'not primed'
    } activeGateway=${env.activeGateway} preferPublic=${env.preferPublic}`
  );
  lines.push(
    `nodes: ${total} total (${truncated ? `${nodeCount} probed` : 'all probed'}), ${withMedia} with media, ` +
      `${broken.length} fully broken, ${noMedia.length} no media yet`
  );
  if (broken.length > 0) {
    lines.push('--- broken nodes ---');
    for (const r of broken) {
      lines.push(
        `node ${r.nodeId} "${r.title}" (dedicated resolve: ${r.dedicatedResolveMs}ms → ${r.dedicatedResolveUrl || 'failed'})`
      );
      for (const c of r.candidates) {
        lines.push(
          `  ${c.ok ? 'OK  ' : 'FAIL'} ${String(c.status ?? '-').padEnd(4)} ${String(c.ms).padStart(5)}ms  ${c.error ?? ''}  ${c.url}`
        );
      }
    }
  }
  console.log(lines.join('\n'));
}

declare global {
  interface Window {
    __loarIpfsDiag?: () => void;
  }
}

/** Registers a manual re-run trigger bound to the given graph/universe, callable from the console as `__loarIpfsDiag()`. */
export function registerIpfsDiagRerun(graphData: GraphData, universeId: string): void {
  if (typeof window === 'undefined') return;
  window.__loarIpfsDiag = () => {
    void runIpfsNodeDiagnostics(graphData, universeId, { force: true });
  };
}
