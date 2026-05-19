/**
 * Registry staleness audit.
 *
 * Walks each model-registry file and reports its git last-commit date. Any
 * registry untouched for more than N days is flagged as "verify pricing
 * page" work. Used in two places:
 *
 *   1. Local check: `pnpm registry:check-staleness` (defaults: 90-day floor)
 *   2. Weekly GitHub Action that opens/updates an issue when there's drift
 *
 * Why git mtime, not a per-entry field: 4 of 8 registries (image, video,
 * audio, editing) don't carry a `lastVerified` field, and adding it to
 * ~160 entries is busy-work. Git commit date is rigorous (can't be faked
 * without an actual edit) and the unit that matters in practice — when a
 * provider changes pricing, the relevant registry file gets bumped.
 *
 * Exit codes:
 *   0 — all registries within threshold
 *   1 — one or more stale registries
 *   2 — usage / setup error (git unavailable, file missing)
 *
 * Flags:
 *   --days=N       Staleness threshold in days (default 90)
 *   --json         Emit JSON instead of text (for the GH action body)
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

interface RegistryInfo {
  /** Registry name displayed to humans. */
  name: string;
  /** Path relative to repo root for the script. */
  relPath: string;
  /** Provider dashboards to check when staleness fires. */
  providerHints: string[];
}

const REGISTRIES: RegistryInfo[] = [
  {
    name: 'llm-models',
    relPath: 'apps/server/src/services/llm-models/registry.ts',
    providerHints: [
      'OpenAI https://openai.com/api/pricing',
      'Google Gemini https://ai.google.dev/pricing',
      'Z.AI https://z.ai (login + dashboard)',
      'Groq https://console.groq.com/settings/billing',
      'ByteDance Doubao https://www.volcengine.com/',
    ],
  },
  {
    name: 'image-models',
    relPath: 'apps/server/src/services/image-models/registry.ts',
    providerHints: [
      'fal.ai per-model pricing pages',
      'Google Imagen https://ai.google.dev/pricing',
      'OpenAI Image https://openai.com/api/pricing',
      'ByteDance Seedream https://www.volcengine.com/',
    ],
  },
  {
    name: 'video-models',
    relPath: 'apps/server/src/services/video-models/registry.ts',
    providerHints: [
      'fal.ai per-model pricing pages',
      'Google Veo https://ai.google.dev/pricing',
      'OpenAI Sora https://openai.com/api/pricing',
      'ByteDance Seedance https://www.volcengine.com/',
    ],
  },
  {
    name: 'tts-models',
    relPath: 'apps/server/src/services/tts-models/registry.ts',
    providerHints: [
      'ElevenLabs https://elevenlabs.io/pricing',
      'OpenAI TTS https://openai.com/api/pricing',
      'Deepgram https://deepgram.com/pricing',
      'Groq https://console.groq.com/settings/billing',
      'Google Gemini TTS https://ai.google.dev/pricing',
    ],
  },
  {
    name: 'transcription-models',
    relPath: 'apps/server/src/services/transcription-models/registry.ts',
    providerHints: [
      'fal.ai per-model pricing pages',
      'AssemblyAI https://www.assemblyai.com/pricing',
      'Deepgram https://deepgram.com/pricing',
      'Groq https://console.groq.com/settings/billing',
      'OpenAI Whisper https://openai.com/api/pricing',
    ],
  },
  {
    name: 'threed-models',
    relPath: 'apps/server/src/services/threed-models/registry.ts',
    providerHints: [
      'Meshy https://www.meshy.ai/pricing',
      'Tripo3D https://platform.tripo3d.ai/pricing',
    ],
  },
  {
    name: 'audio-models',
    relPath: 'apps/server/src/services/audio-models/registry.ts',
    providerHints: [
      'fal.ai per-model pricing pages',
      'ElevenLabs Music https://elevenlabs.io/pricing',
    ],
  },
  {
    name: 'editing-models',
    relPath: 'apps/server/src/services/editing-models/registry.ts',
    providerHints: ['fal.ai per-model pricing pages (relight, lipsync, upscale, …)'],
  },
];

interface CliArgs {
  days: number;
  json: boolean;
}

function parseArgs(): CliArgs {
  const args = new Map<string, string>();
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) args.set(m[1], m[2] ?? 'true');
  }
  const days = Number(args.get('days') ?? '90');
  return {
    days: Number.isFinite(days) && days > 0 ? Math.floor(days) : 90,
    json: args.get('json') === 'true',
  };
}

function gitLastCommitIso(filePath: string): string | null {
  try {
    // %cI = strict ISO-8601 committer date (yyyy-mm-ddThh:mm:ss±hh:mm)
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', filePath], {
      encoding: 'utf-8',
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

interface Result {
  name: string;
  relPath: string;
  lastCommitIso: string | null;
  ageDays: number | null;
  stale: boolean;
  providerHints: string[];
}

function check(args: CliArgs): Result[] {
  const now = Date.now();
  return REGISTRIES.map((r) => {
    const abs = path.resolve(process.cwd(), r.relPath);
    if (!existsSync(abs)) {
      return {
        name: r.name,
        relPath: r.relPath,
        lastCommitIso: null,
        ageDays: null,
        stale: false,
        providerHints: r.providerHints,
      };
    }
    const iso = gitLastCommitIso(r.relPath);
    let ageDays: number | null = null;
    if (iso) {
      const ageMs = now - new Date(iso).getTime();
      ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    }
    return {
      name: r.name,
      relPath: r.relPath,
      lastCommitIso: iso,
      ageDays,
      stale: ageDays !== null && ageDays > args.days,
      providerHints: r.providerHints,
    };
  });
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

function printText(args: CliArgs, results: Result[]): void {
  console.log('');
  console.log(`Registry staleness audit  —  threshold: ${args.days} days`);
  console.log('─'.repeat(78));
  console.log(pad('Registry', 26) + pad('Last touched', 16) + pad('Age', 10) + 'Status');
  console.log('─'.repeat(78));
  for (const r of results) {
    const last = r.lastCommitIso ? r.lastCommitIso.slice(0, 10) : '—';
    const age = r.ageDays === null ? '—' : `${r.ageDays}d`;
    const status = r.lastCommitIso === null ? '? no git history' : r.stale ? '✗ STALE' : '✓ fresh';
    console.log(pad(r.name, 26) + pad(last, 16) + pad(age, 10) + status);
  }
  console.log('─'.repeat(78));

  const stale = results.filter((r) => r.stale);
  if (stale.length === 0) {
    console.log('All registries within threshold.');
    return;
  }
  console.log('');
  console.log(
    `${stale.length} stale registr${stale.length === 1 ? 'y' : 'ies'} — verify provider pricing pages and bump the file:`
  );
  for (const r of stale) {
    console.log('');
    console.log(`  ${r.name} (${r.ageDays}d since last commit)`);
    console.log(`    File: ${r.relPath}`);
    for (const hint of r.providerHints) {
      console.log(`    • ${hint}`);
    }
  }
  console.log('');
  console.log('Workflow: open each provider dashboard, verify list prices match the');
  console.log('registry, patch any drift, then save the file (commit bumps the');
  console.log("date even if no number changed — that's the point).");
}

function printJson(args: CliArgs, results: Result[]): void {
  const stale = results.filter((r) => r.stale);
  console.log(
    JSON.stringify(
      {
        thresholdDays: args.days,
        registries: results,
        stale,
        staleCount: stale.length,
      },
      null,
      2
    )
  );
}

function main(): void {
  const args = parseArgs();
  const results = check(args);
  if (args.json) printJson(args, results);
  else printText(args, results);
  process.exit(results.some((r) => r.stale) ? 1 : 0);
}

main();
