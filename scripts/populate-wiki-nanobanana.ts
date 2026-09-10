/**
 * Fill wiki entity covers (and, optionally, universe hero art) with Nano Banana
 * for ONE, SEVERAL, or EVERY universe the signing wallet owns.
 *
 * This is the generic, universe-agnostic sibling of
 * scripts/populate-techno-antichrist-wiki.ts. It has no hand-authored per-entity
 * art direction — the prompt is built from each entity's own name / kind /
 * description plus a short STYLE line derived from the universe's own synopsis,
 * so every universe's covers land on its own genre without a bespoke script.
 * For a marquee universe that deserves cast-accurate covers, still write a
 * dedicated populate-<slug>-wiki.ts with a VISUAL map.
 *
 * Phases (either selectable; both run when neither flag is passed):
 *   --covers   Draw a cover for every entity in scope that has no imageUrl and
 *              write it back via entities.update. --force redoes existing ones.
 *   --hero     Draw landscape + portrait key art for a universe that has no
 *              image_url and set it via universes.updateMetadata. --force redoes.
 *
 * Scope:
 *   --all                 Every universe whose `creator` == the signing address.
 *   --universe=<addr>     Target one universe (repeatable). Case-sensitive for
 *                         Solana PDAs — never lowercased.
 *   (no scope flag)       Error — refuse to guess.
 *
 * Safety / tuning:
 *   --dry-run     Generate nothing, write nothing — print the plan. DEFAULT.
 *   --commit      Actually generate + write. Without this it is a dry run.
 *   --no-fallback Fail an image instead of letting image.generate sub a fal model.
 *   --limit=N     Cap entities touched per universe in --covers.
 *   --only=Str    --covers only for entities whose name contains Str (ci).
 *   --chain=X     Force auth chain: evm | solana (default: detect from key).
 *   --model=Id    image-model id (default: nano-banana-pro-google).
 *   --prod        Shorthand for SERVER_URL=https://api.loar.fun WEB_ORIGIN=https://loar.fun
 *
 * Env:
 *   PRIVATE_KEY        (required) EVM hex or Solana base58/json/hex key that owns
 *                      the target universe(s). Must equal each universe's
 *                      `creator` (entities.update / universes.updateMetadata are
 *                      creator-gated server-side).
 *   SERVER_URL         tRPC base (default: VITE_SERVER_URL or http://localhost:3000)
 *   WEB_ORIGIN         SIWx domain + Origin (default http://localhost:5173; prod
 *                      https://loar.fun — must be in SIWE_ALLOWED_DOMAINS + CORS_ORIGIN)
 *   CHAIN_ID           SIWE chain id (default 11155111 / Sepolia)
 *   SOLANA_CLUSTER     SIWS cluster (default mainnet-beta)
 *   NANO_BANANA_MODEL  image-model id (default nano-banana-pro-google; alts:
 *                      nano-banana, nano-banana-google-ga)
 *
 * Each image bills ~5 universeCredits to the target universe. A universe only
 * ever seeded in the emulator has no universeCredits doc on prod and the first
 * real run fails fast with INSUFFICIENT_CREDITS — seed it first.
 *
 * Usage:
 *   pnpm tsx scripts/populate-wiki-nanobanana.ts --all --dry-run
 *   PRIVATE_KEY=<owner> pnpm tsx scripts/populate-wiki-nanobanana.ts --prod --all --dry-run
 *   PRIVATE_KEY=<owner> pnpm tsx scripts/populate-wiki-nanobanana.ts --prod \
 *     --universe=0x341fFa19c0EC8D2C8eF42A360cf799949844262e --covers --only="Null" --commit
 *   PRIVATE_KEY=<owner> pnpm tsx scripts/populate-wiki-nanobanana.ts --prod --all --covers --commit
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { resolveAuth, detectAuthChain, type AuthChain, type SolanaCluster } from './lib/wiki-auth';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => {
  const a = args.find((x) => x.startsWith(`${f}=`));
  return a ? a.slice(f.length + 1) : undefined;
};
const vals = (f: string) =>
  args.filter((x) => x.startsWith(`${f}=`)).map((x) => x.slice(f.length + 1));

// ── Config ────────────────────────────────────────────────────────────
const rawKey = process.env.PRIVATE_KEY ?? '';
if (!rawKey) {
  console.error('PRIVATE_KEY is required — the EVM/Solana key that owns the target universe(s).');
  process.exit(1);
}

const PROD = has('--prod');
const SERVER_URL = (
  process.env.SERVER_URL ??
  (PROD ? 'https://api.loar.fun' : undefined) ??
  process.env.VITE_SERVER_URL ??
  'http://localhost:3000'
).replace(/\/$/, '');
const WEB_ORIGIN = (
  process.env.WEB_ORIGIN ?? (PROD ? 'https://loar.fun' : 'http://localhost:5173')
).replace(/\/$/, '');
const CHAIN_ID = Number(process.env.CHAIN_ID ?? '11155111');
const NANO_BANANA_MODEL =
  val('--model') ?? process.env.NANO_BANANA_MODEL ?? 'nano-banana-pro-google';

const AUTH_CHAIN = ((val('--chain') ?? process.env.AUTH_CHAIN)?.toLowerCase() ||
  detectAuthChain(rawKey)) as AuthChain;
const SOLANA_CLUSTER = (process.env.SOLANA_CLUSTER ?? 'mainnet-beta') as SolanaCluster;

// --commit is the real switch; --dry-run is the (default) opposite. Dry unless
// --commit is explicitly present.
const DRY_RUN = !has('--commit');
const FORCE = has('--force');
const ALLOW_FALLBACK = !has('--no-fallback');
const LIMIT = val('--limit') ? Number(val('--limit')) : Infinity;
const ONLY = val('--only')?.toLowerCase();
const ALL = has('--all');
const UNIVERSES = vals('--universe'); // case-sensitive; do not lowercase

if (!ALL && UNIVERSES.length === 0) {
  console.error('Scope required: pass --all or one/more --universe=<addr>.');
  process.exit(1);
}

let phases = { covers: has('--covers'), hero: has('--hero') };
if (!phases.covers && !phases.hero) phases = { covers: true, hero: true };

// ── Style ─────────────────────────────────────────────────────────────
// Universe-agnostic framing per entity kind + a fixed cinematic / no-text tail.
// The per-universe flavour comes from STYLE_FROM_SYNOPSIS() below.
const KIND_FRAMING: Record<string, string> = {
  person:
    'cinematic environmental portrait, chest-up to three-quarter, shallow depth of field, expressive face, motivated practical light',
  place:
    'wide establishing shot, real sense of scale and architecture, atmospheric light, no readable signage',
  faction:
    'group tableau that reads a shared identity, posture and insignia, available light, slightly unposed',
  organization:
    'a command / operations tableau in a real interior, a through-line motif present but understated',
  event: 'wide cinematic tableau of the moment itself — crowd, light and staging doing the work',
  lore: 'a single striking symbolic still-life, grounded and photographable, mysterious but real',
  species: 'creature study, anatomical weight and silhouette, dramatic pose in its habitat',
  vehicle: 'the vehicle in its environment, dramatic three-quarter angle, wear and detail',
  thing: 'a hero prop / object render, dramatic raking light, texture and patina',
  technology: 'a detailed device render, clean readable form, motivated glow, no UI text',
};

const STYLE_TAIL =
  'Photoreal cinematic frame, anamorphic, fine film grain, motivated practical light, strong composition. ' +
  'No on-image text, no captions, no watermark, no logo, no UI chrome, no borders.';

/** A ≤240-char flavour line pulled from the universe's own synopsis. */
function styleFromSynopsis(name: string, description: string): string {
  const clean = (description ?? '').replace(/\s+/g, ' ').trim();
  const slice = clean.length > 260 ? clean.slice(0, 260).replace(/\s+\S*$/, '') + '…' : clean;
  return `"${name}" visual world — ${slice || 'a distinctive, internally consistent cinematic setting'}.`;
}

function buildEntityPrompt(
  entityName: string,
  kind: string,
  entityDesc: string,
  universeStyle: string
): string {
  const subject = `${entityName} — ${(entityDesc ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)}.`;
  const framing = KIND_FRAMING[kind] ?? 'cinematic concept still, grounded and photoreal';
  return [subject, framing + '.', universeStyle, STYLE_TAIL].join(' ');
}

function sizeForKind(kind: string, name: string): string {
  if (/^ep\s|^episode\s|—\s*ep\s/i.test(name)) return 'landscape_16_9';
  if (['place', 'event', 'faction', 'organization', 'vehicle'].includes(kind))
    return 'landscape_16_9';
  return 'square_hd';
}

// ── plumbing (mirrors populate-techno-antichrist-wiki.ts) ─────────────
function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tRPCMutate<T>(procedure: string, input: unknown, token: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}/trpc/${procedure}?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ '0': input }),
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 400)}`);
  return json[0]?.result?.data;
}

async function tRPCQuery<T>(procedure: string, input: unknown, token: string): Promise<T> {
  const url = `${SERVER_URL}/trpc/${procedure}?batch=1&input=${encodeURIComponent(
    JSON.stringify({ '0': input })
  )}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 400)}`);
  return json[0]?.result?.data;
}

async function genImage(
  prompt: string,
  token: string,
  universeId: string,
  imageSize: string
): Promise<string | null> {
  if (DRY_RUN) {
    console.log(`      [dry-run] would generate (${imageSize}): ${prompt.slice(0, 110)}…`);
    return null;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await tRPCMutate<{
        imageUrls?: string[];
        modelUsed?: string;
        wasFallback?: boolean;
      }>(
        'image.generate',
        {
          prompt,
          task: 'text_to_image',
          imageSize,
          numImages: 1,
          routingMode: 'manual',
          selectedModelId: NANO_BANANA_MODEL,
          allowFallback: ALLOW_FALLBACK,
          useWikiContext: false,
          universeId,
        },
        token
      );
      const url = r?.imageUrls?.[0] ?? null;
      if (url) {
        const tag = r?.wasFallback
          ? `${r.modelUsed} (fallback)`
          : (r?.modelUsed ?? NANO_BANANA_MODEL);
        console.log(`      image ok via ${tag}: ${url.slice(0, 80)}…`);
      }
      return url;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/insufficient_credits|insufficient credits/i.test(msg)) {
        console.log(`      INSUFFICIENT_CREDITS — skipping the rest of this universe`);
        throw Object.assign(new Error('INSUFFICIENT_CREDITS'), { code: 'INSUFFICIENT_CREDITS' });
      }
      if (/moderation_blocked|moderation/i.test(msg)) {
        console.log(`      MODERATION_BLOCKED — leaving this entity uncovered (no retry)`);
        return null;
      }
      if (/429|rate.?limit/i.test(msg) && attempt < 3) {
        const backoff = 4000 * attempt;
        console.log(`      rate-limited, retrying in ${backoff}ms…`);
        await sleep(backoff);
        continue;
      }
      console.log(`      image gen failed: ${msg.slice(0, 180)}`);
      return null;
    }
  }
  return null;
}

async function listEntities(universeId: string, token: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const page = await tRPCQuery<{ entities: any[]; nextCursor?: string }>(
      'entities.list',
      { universeAddress: universeId, limit: 200, cursor },
      token
    );
    out.push(...(page?.entities ?? []));
    cursor = page?.nextCursor;
  } while (cursor);
  return out;
}

// ── Phases ────────────────────────────────────────────────────────────
async function runCovers(u: TargetUniverse, token: string) {
  const universeStyle = styleFromSynopsis(u.name, u.description);
  const entities = await listEntities(u.id, token);
  let targets = entities.filter((e) => FORCE || !e.imageUrl);
  if (ONLY) targets = targets.filter((e) => (e.name as string).toLowerCase().includes(ONLY));
  if (LIMIT !== Infinity) targets = targets.slice(0, LIMIT);

  log('covers', `${u.name}: ${entities.length} entities, ${targets.length} to (re)cover`);
  let done = 0;
  for (const e of targets) {
    console.log(`\n  • ${u.name} / ${e.name} (${e.kind})${e.imageUrl ? ' [replacing]' : ''}`);
    const prompt = buildEntityPrompt(e.name, e.kind, e.description ?? '', universeStyle);
    const url = await genImage(prompt, token, u.id, sizeForKind(e.kind, e.name));
    if (!url || DRY_RUN) continue;
    try {
      await tRPCMutate('entities.update', { entityId: e.id, imageUrl: url }, token);
      log('covers', `updated ${e.name}`);
      done++;
    } catch (err: any) {
      log('covers', `update failed for ${e.name}: ${err.message?.slice(0, 160)}`);
    }
    await sleep(2000);
  }
  log('covers', `${u.name}: done — ${done} covers written`);
}

async function runHero(u: TargetUniverse, token: string) {
  if (u.heroImageUrl && !FORCE) {
    log('hero', `${u.name}: already has hero art — skip (use --force to redo)`);
    return;
  }
  const universeStyle = styleFromSynopsis(u.name, u.description);
  const landscapePrompt = [
    `Key art for "${u.name}": a single iconic wide hero frame that captures the world and its central tension.`,
    'Cinematic poster composition, landscape, depth, one clear focal subject.',
    universeStyle,
    STYLE_TAIL,
  ].join(' ');
  const portraitPrompt = [
    `Vertical key art for "${u.name}": the same world, a tight vertical hero composition with a single focal subject.`,
    universeStyle,
    STYLE_TAIL,
  ].join(' ');

  const image = await genImage(landscapePrompt, token, u.id, 'landscape_16_9');
  await sleep(2000);
  const portrait = await genImage(portraitPrompt, token, u.id, 'portrait_16_9');
  if (DRY_RUN) return;

  const payload: Record<string, unknown> = { universeId: u.id };
  if (image) payload.imageUrl = image;
  if (portrait) payload.portraitImageUrl = portrait;
  if (!image && !portrait) {
    log('hero', `${u.name}: no images generated — skipping updateMetadata`);
    return;
  }
  try {
    await tRPCMutate('universes.updateMetadata', payload, token);
    log(
      'hero',
      `${u.name}: metadata updated (${Object.keys(payload)
        .filter((k) => k !== 'universeId')
        .join(', ')})`
    );
  } catch (err: any) {
    log('hero', `${u.name}: updateMetadata failed: ${err.message?.slice(0, 180)}`);
  }
}

// ── Target resolution ────────────────────────────────────────────────
interface TargetUniverse {
  id: string;
  name: string;
  description: string;
  heroImageUrl?: string;
  creator?: string;
}

async function resolveTargets(token: string, signer: string): Promise<TargetUniverse[]> {
  const raw = await tRPCQuery<any>('universes.getAll', {}, token);
  const list: any[] = (raw?.data ?? raw ?? []) as any[];
  const norm = (u: any): TargetUniverse => ({
    id: u.id,
    name: u.name ?? '(unnamed)',
    description: u.description ?? u.synopsis ?? '',
    heroImageUrl: u.image_url ?? u.imageUrl ?? undefined,
    creator: (u.creator ?? u.createdBy ?? '').toString(),
  });

  if (UNIVERSES.length > 0) {
    const bySameId = new Map(list.map((u) => [String(u.id), u]));
    return UNIVERSES.map((id) => {
      const hit =
        bySameId.get(id) ?? list.find((u) => String(u.id).toLowerCase() === id.toLowerCase());
      if (!hit) {
        console.warn(`  ! --universe=${id} not found in universes.getAll — using id only`);
        return { id, name: id, description: '' };
      }
      return norm(hit);
    });
  }

  // --all : every universe this wallet created
  const mine = list.filter((u) => {
    const c = (u.creator ?? u.createdBy ?? '').toString().toLowerCase();
    return c && c === signer.toLowerCase();
  });
  return mine.map(norm);
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(64));
  console.log('  Wiki cover / hero art — Nano Banana (generic, multi-universe)');
  console.log('═'.repeat(64));
  console.log(`  server   : ${SERVER_URL}`);
  console.log(`  origin   : ${WEB_ORIGIN}`);
  console.log(`  model    : ${NANO_BANANA_MODEL}`);
  console.log(`  scope    : ${ALL ? 'ALL universes I created' : UNIVERSES.join(', ')}`);
  console.log(
    `  phases   : ${Object.entries(phases)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ')}`
  );
  console.log(
    `  mode     : ${DRY_RUN ? 'DRY RUN (pass --commit to write)' : 'COMMIT — will generate + write'}` +
      `${FORCE ? '   force: true' : ''}${ALLOW_FALLBACK ? '' : '   no-fallback: true'}`
  );
  if (LIMIT !== Infinity) console.log(`  limit    : ${LIMIT} / universe`);
  if (ONLY) console.log(`  only     : ${ONLY}`);

  log('AUTH', `authenticating (${AUTH_CHAIN === 'solana' ? 'SIWS' : 'SIWE'})…`);
  const auth = await resolveAuth({
    serverUrl: SERVER_URL,
    webOrigin: WEB_ORIGIN,
    privateKey: rawKey,
    chain: AUTH_CHAIN,
    evmChainId: CHAIN_ID,
    solanaCluster: SOLANA_CLUSTER,
  });
  const signer = auth.evmAddress ?? auth.address;
  log(
    'AUTH',
    `${auth.chain.toUpperCase()} signer: ${auth.address}${auth.evmAddress ? ` → linked EVM ${auth.evmAddress}` : ''}`
  );

  const targets = await resolveTargets(auth.token, signer);
  if (targets.length === 0) {
    console.log('\nNo target universes resolved. Nothing to do.');
    return;
  }

  console.log(`\n  ${targets.length} universe(s) in scope:`);
  for (const t of targets) {
    const owned = !t.creator || t.creator.toLowerCase() === signer.toLowerCase();
    console.log(
      `   - ${t.name.padEnd(34)} ${String(t.id).slice(0, 24).padEnd(24)} hero:${t.heroImageUrl ? 'y' : 'MISSING'}` +
        `${owned ? '' : '  ⚠ NOT owned by signer — writes will 403'}`
    );
  }

  for (const t of targets) {
    console.log(`\n${'─'.repeat(64)}\n  ${t.name}\n${'─'.repeat(64)}`);
    try {
      if (phases.covers) await runCovers(t, auth.token);
      if (phases.hero) await runHero(t, auth.token);
    } catch (err: any) {
      if (err?.code === 'INSUFFICIENT_CREDITS') {
        log('skip', `${t.name}: out of universeCredits — moving on`);
        continue;
      }
      throw err;
    }
  }

  console.log('\n' + '═'.repeat(64));
  console.log(`  DONE${DRY_RUN ? ' (dry run — nothing written)' : ''}`);
  console.log('═'.repeat(64));
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});
