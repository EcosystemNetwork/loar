/**
 * Layer 8 — editing (PRDs 1-10: Edit Canvas, Inpaint, Outpaint, Relight,
 *                     Retexture, Identity Lock, Pose/Shot, Image-to-Video,
 *                     Workflows, Lineage)
 *
 * Verifies the routers landed in commit 2446567 are actually registered and
 * respond to tRPC requests against a live server. Covers:
 *
 *   public endpoints — readable without auth
 *   authenticated reads — require SIWE JWT, no side effects
 *   input validation — a NOT_FOUND or empty result is a pass; a 404 from
 *     tRPC ("No procedure found on path") is a fail.
 *
 * What this does NOT cover:
 *   - Creating a real content doc, opening an edit session, running the
 *     editing model, promoting the job to a version. That requires storage
 *     upload + content.create + FAL_KEY and is out of scope for a smoke
 *     layer — wire those into an integration test.
 *   - Firestore composite indexes: some queries (e.g. editJobs.listByContent,
 *     lineage.byUniverse) require deployed indexes. Run
 *     `firebase deploy --only firestore:indexes` before expecting those to
 *     return 200. Until then this layer reports them as "known-index-needed".
 */
import type { SmokeConfig } from '../config.ts';
import { tRPCQuery } from '../client.ts';
import { check, skipped, type CheckResult } from '../reporter.ts';

export interface EditingResult {
  checks: CheckResult[];
}

const FAKE_ASSET_ID = 'smoke-probe-asset';
const FAKE_CONTENT_ID = 'smoke-probe-content';
const FAKE_UNIVERSE_ADDRESS = '0x0000000000000000000000000000000000000000';
const FAKE_SHOT_ID = 'smoke-probe-shot';

/**
 * A probe passes if:
 *   - tRPC returns 200 with the expected (possibly empty) shape, OR
 *   - tRPC returns NOT_FOUND (expected for probe IDs that don't exist), OR
 *   - tRPC returns UNAUTHORIZED (expected for protected procs without a token)
 *
 * It fails if the procedure path itself is missing (router not registered).
 */
async function probe(
  cfg: SmokeConfig,
  procedure: string,
  input: unknown,
  token?: string,
  acceptableCodes: string[] = ['NOT_FOUND', 'UNAUTHORIZED', 'BAD_REQUEST']
): Promise<string> {
  try {
    const data = await tRPCQuery(cfg, procedure, input, token);
    if (Array.isArray(data)) return `ok → [${data.length}]`;
    if (data && typeof data === 'object') {
      const keys = Object.keys(data as Record<string, unknown>)
        .slice(0, 3)
        .join(',');
      return `ok → {${keys}}`;
    }
    return `ok → ${String(data).slice(0, 20)}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A missing router shows up as `No procedure found on path "X"`
    if (/No procedure found on path/.test(msg)) {
      throw new Error(`ROUTER NOT REGISTERED: ${procedure}`);
    }
    // A missing Firestore composite index is a deploy problem, not a code
    // problem. Surface it as "known-index-needed" so the smoke run highlights
    // what infrastructure work is still pending.
    if (/FAILED_PRECONDITION.*requires an index/.test(msg)) {
      return `known-index-needed`;
    }
    for (const code of acceptableCodes) {
      if (msg.includes(code)) return `expected:${code}`;
    }
    // tRPC error messages strip the code prefix; check for the human message
    // commonly surfaced by TRPCError({ code: 'NOT_FOUND' }).
    if (acceptableCodes.includes('NOT_FOUND') && /not found/i.test(msg)) {
      return 'expected:NOT_FOUND';
    }
    throw err;
  }
}

export async function runEditingLayer(cfg: SmokeConfig, token: string): Promise<EditingResult> {
  const checks: CheckResult[] = [];

  // ── PRD 1: Edit Canvas (editJobs router) ───────────────────────────────
  checks.push(
    await check('editJobs.listByContent → registered', async () =>
      probe(cfg, 'editJobs.listByContent', { contentId: FAKE_CONTENT_ID, limit: 5 })
    )
  );
  checks.push(
    await check('editJobs.listVersions → registered', async () =>
      probe(cfg, 'editJobs.listVersions', { contentId: FAKE_CONTENT_ID })
    )
  );

  // ── PRD 4: Tone packs (relight/mood presets) ───────────────────────────
  checks.push(
    await check('universeTonePacks.list → registered', async () =>
      probe(cfg, 'universeTonePacks.list', { universeAddress: FAKE_UNIVERSE_ADDRESS })
    )
  );

  // ── PRD 7: Shot templates ──────────────────────────────────────────────
  checks.push(
    await check('shotTemplates.get → registered', async () =>
      probe(cfg, 'shotTemplates.get', { shotTemplateId: FAKE_SHOT_ID })
    )
  );

  // ── PRD 10: Lineage ────────────────────────────────────────────────────
  checks.push(
    await check('lineage.getEvent → registered', async () =>
      probe(cfg, 'lineage.getEvent', { assetId: FAKE_ASSET_ID })
    )
  );
  checks.push(
    await check('lineage.ancestors → registered', async () =>
      probe(cfg, 'lineage.ancestors', { assetId: FAKE_ASSET_ID })
    )
  );
  checks.push(
    await check('lineage.descendants → registered', async () =>
      probe(cfg, 'lineage.descendants', { assetId: FAKE_ASSET_ID, limit: 10 })
    )
  );
  checks.push(
    await check('lineage.tree → registered', async () =>
      probe(cfg, 'lineage.tree', { rootAssetId: FAKE_ASSET_ID, limit: 10 })
    )
  );
  checks.push(
    await check('lineage.byUniverse → registered', async () =>
      probe(cfg, 'lineage.byUniverse', { universeAddress: FAKE_UNIVERSE_ADDRESS, limit: 10 })
    )
  );

  // ── Authenticated reads (need SIWE JWT) ────────────────────────────────
  if (token) {
    // PRD 9: Workflows (protected)
    checks.push(
      await check('workflows.list → registered (auth)', async () =>
        probe(cfg, 'workflows.list', { limit: 10 }, token)
      )
    );
    // PRD 7: Shot templates (protected list)
    checks.push(
      await check('shotTemplates.list → registered (auth)', async () =>
        probe(cfg, 'shotTemplates.list', {}, token)
      )
    );
    // PRD 10: Lineage credit summary (protected). Requires universeId; we pass
    // a fake one — the assertUniverseOwner gate will reject as FORBIDDEN/NOT_FOUND
    // which is enough to prove the procedure is registered and running.
    checks.push(
      await check('lineage.creditSummary → registered (auth)', async () =>
        probe(
          cfg,
          'lineage.creditSummary',
          { universeId: FAKE_UNIVERSE_ADDRESS, range: 'all' },
          token,
          ['NOT_FOUND', 'UNAUTHORIZED', 'BAD_REQUEST', 'FORBIDDEN']
        )
      )
    );
  } else {
    checks.push(skipped('authenticated editing reads', 'no JWT from auth layer'));
  }

  return { checks };
}
