/**
 * Fill every Techno Antichrist entity's wiki with a full, internally-consistent
 * in-world article + structured metadata, so downstream image/video generation
 * (and LOAR's own useWikiContext) draws on one coherent canon.
 *
 * One Gemini call per entity, each given the universe synopsis + the FULL roster
 * of all 48 entities (name · kind · one-liner) so names, dates, places and
 * relationships line up across articles. Writes back entities[].description (the
 * article) and merges entities[].metadata. Nothing is generated with images or
 * Veo here — text only, which has no per-window quota wall.
 *
 * Run via `railway run --service loar --` for the injected GOOGLE_API_KEY + creds.
 *
 *   railway run --service loar -- pnpm tsx scripts/fill-techno-antichrist-wiki.ts --live --dry-run
 *   railway run --service loar -- pnpm tsx scripts/fill-techno-antichrist-wiki.ts --live --only="Rex Duce"
 *   railway run --service loar -- pnpm tsx scripts/fill-techno-antichrist-wiki.ts --live
 *
 * Flags: --live  --dry-run  --force (rewrite already-filled)  --only=Sub
 *        --limit=N  --model=ID (default gemini-2.5-pro)
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { geminiChat } from '../apps/server/src/services/gemini';
import { VISUAL, EPISODE_VISUAL } from './lib/ta-visual';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => {
  const a = args.find((x) => x.startsWith(`${f}=`));
  return a ? a.slice(f.length + 1) : undefined;
};

if (has('--live')) delete process.env.FIRESTORE_EMULATOR_HOST;

const UNIVERSE_ID = 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL';
const DRY_RUN = has('--dry-run');
const FORCE = has('--force');
const ONLY = val('--only')?.toLowerCase();
const LIMIT = val('--limit') ? Number(val('--limit')) : Infinity;
const MODEL = val('--model') ?? 'gemini-2.5-pro';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const KIND_META_HINT: Record<string, string> = {
  person:
    'aliases, age, occupation, affiliation, firstAppearance (episode), status, keyRelationships (array of "Name — relation")',
  place: 'location, controlledBy, firstAppearance, atmosphere, significance, keyEvents (array)',
  faction:
    'type, leader, size, allegiance, headquarters, firstAppearance, goal, keyMembers (array)',
  lore: 'category, origin, firstReferenced, relatedConcepts (array), significance',
  event: 'type, episode, location, participants (array of names), outcome, significance',
  organization: 'type, leadership, jurisdiction, firstAppearance, mandate, keyPersonnel (array)',
};

const SYSTEM = [
  "You are the lead archivist for the writers' room of TECHNO ANTICHRIST, a prestige limited series.",
  'You write in-world encyclopedia articles: authoritative, specific, quietly witty, never breathless.',
  'Absolute rule: stay consistent with the supplied universe synopsis and the full cast roster.',
  'Refer to other entities by their EXACT roster name. Invent supporting detail freely, but never',
  "contradict the roster (a character's role, a place's function, an episode's events).",
  'No spoiler-warnings, no "in this article", no meta. Present tense for the world, past tense for its history.',
  '',
  'CANON ANCHORS (never contradict):',
  '- The Antichrist in this gospel is the whistleblower who publishes the org chart, not the adversary.',
  '- In the finale Rex Duce publishes The Org Chart with HIMSELF DELETED from it, hands doctrinal authority to The Cartographer live by video, and SURVIVES; being alive is the anticlimax that breaks the spell.',
  '- Whether Rex genuinely believes, or is a grifter, is never resolved — write around it, do not settle it.',
  "- The Interference / Laser Acid / Moonbase / the tower's link to G.O.D. are never confirmed real; every impossible thing has a mundane twin.",
  "- Ep 7: Rex takes Hana's phone and bites her on the way out; the show sees this clearly as harm and does not adopt his justification.",
].join(' ');

interface Ent {
  ref: FirebaseFirestore.DocumentReference;
  id: string;
  name: string;
  kind: string;
  description: string;
  metadata?: Record<string, unknown>;
}

async function main() {
  if (!GOOGLE_API_KEY)
    throw new Error('GOOGLE_API_KEY not in env — run through `railway run --service loar --`');

  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? `${process.env.HOME}/.config/loar/loar-db-sa.json`
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  initializeApp({ credential: cert(sa) });
  const db = getFirestore();
  db.settings({ preferRest: true });

  const uDoc = await db.collection('cinematicUniverses').doc(UNIVERSE_ID).get();
  const synopsis = String((uDoc.data() as any)?.description ?? '').slice(0, 4000);

  const snap = await db.collection('entities').where('universeAddress', '==', UNIVERSE_ID).get();
  const all: Ent[] = snap.docs
    .map((d) => ({ ref: d.ref, id: d.id, ...(d.data() as any) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  // Roster from the ORIGINAL stubs (stable reference for every call this run).
  const roster = all
    .map(
      (e) => `- ${e.name} [${e.kind}] — ${String(e.description).replace(/\s+/g, ' ').slice(0, 180)}`
    )
    .join('\n');

  let targets = all.filter((e) => FORCE || String(e.description).length < 1200);
  if (ONLY) targets = targets.filter((e) => e.name.toLowerCase().includes(ONLY));
  if (LIMIT !== Infinity) targets = targets.slice(0, LIMIT);

  console.log('\n' + '='.repeat(66));
  console.log('  Techno Antichrist — fill wiki articles + metadata');
  console.log('='.repeat(66));
  console.log(`  Model   : ${MODEL}`);
  console.log(`  Entities: ${all.length} total, ${targets.length} to fill`);
  console.log(`  Dry run : ${DRY_RUN}${FORCE ? '   force: true' : ''}\n`);

  let ok = 0;
  for (const e of targets) {
    const bible = EPISODE_VISUAL[e.name] ?? VISUAL[e.name] ?? '';
    const metaHint = KIND_META_HINT[e.kind] ?? 'a few key structured facts';
    const user = [
      `UNIVERSE SYNOPSIS:\n${synopsis}`,
      `\nFULL ROSTER (do not contradict):\n${roster}`,
      `\nWRITE THE WIKI FOR: "${e.name}"  (kind: ${e.kind})`,
      `Current stub: ${e.description}`,
      bible ? `Series-bible visual note: ${bible}` : '',
      `\nReturn JSON: {`,
      `  "article": "<600-900 word in-world encyclopedia article as Markdown; 4-7 paragraphs; a bold lead sentence; weave in at least three other roster entities by exact name; for a person cover origin, role in the movement, the money/marriage/paranoia pressure as relevant, and where they stand by the finale; for a place/lore/event cover what it is, how it works in-world, who is tied to it, and why it matters">,`,
      `  "metadata": { ${metaHint} }`,
      `}`,
      `metadata values are short strings or arrays of short strings. Use the roster's exact names in relationship fields.`,
    ]
      .filter(Boolean)
      .join('\n');

    console.log(`  • ${e.name} (${e.kind})`);
    if (DRY_RUN) {
      console.log(`      prompt ${user.length} chars, roster ${roster.length} chars`);
      continue;
    }
    try {
      const r = await geminiChat({
        apiKey: GOOGLE_API_KEY,
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
        temperature: 0.85,
        maxOutputTokens: 4096,
        jsonMode: true,
      });
      let parsed: { article?: string; metadata?: Record<string, unknown> };
      try {
        parsed = JSON.parse(r.text);
      } catch {
        const m = r.text.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : {};
      }
      const article = String(parsed.article ?? '').trim();
      if (article.length < 400) throw new Error(`article too short (${article.length})`);
      const meta = parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {};
      const cleanMeta: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(meta)) {
        if (Array.isArray(v)) cleanMeta[k] = v.map((x) => String(x)).slice(0, 12);
        else if (v != null && String(v).trim()) cleanMeta[k] = String(v).slice(0, 400);
      }
      await e.ref.update({
        description: article,
        metadata: { ...(e.metadata ?? {}), ...cleanMeta },
        wikiFilled: true,
        wikiFilledAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(
        `      ✓ ${article.length} chars, ${Object.keys(cleanMeta).length} metadata keys`
      );
      ok++;
    } catch (err: any) {
      console.log(`      ✗ ${err?.message?.slice(0, 200) ?? err}`);
    }
    await sleep(1200);
  }

  console.log(`\n  done — ${ok}/${targets.length} filled`);
  console.log(`  /universe/${UNIVERSE_ID}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\nFAILED:', err?.message ?? err);
  process.exit(1);
});
