/**
 * Generate the 5 music tracks for First Proof (previously failed because of
 * missing FAL package at root) and re-mix all 75 final MP4s to include music.
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import * as fal from '@fal-ai/serverless-client';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const FK = process.env.FAL_KEY!;
const ODIR = process.env.FP_OUTPUT_DIR || './firstproof-output';
const FINAL = path.join(ODIR, 'final');
const MUSIC = path.join(ODIR, 'music');
const VIDEOS = path.join(ODIR, 'videos');
const DIALOGUE = path.join(ODIR, 'dialogue');
const SFX = path.join(ODIR, 'sfx');

if (!FK) {
  console.error('FAL_KEY required');
  process.exit(1);
}
fal.config({ credentials: FK });

const MUS = [
  {
    id: 'act1',
    sc: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    p: 'Religious dystopia dawn. Cathedral strings meet machine hum. Liturgical beauty laced with quiet menace. Ethereal vocals with digital undertone. Sacred and unsettling. No lyrics.',
  },
  {
    id: 'act2',
    sc: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
    p: 'Underground resistance ambient. Warm amber analog synth, tube radio crackle, defiance without aggression. Low-budget hope. Warm vintage pads with rusted edge. No lyrics.',
  },
  {
    id: 'act3',
    sc: [23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35],
    p: 'Ceremonial descent. Golden processional strings dissolving into paranoid synth, doubt creeping in under beauty. Cathedral sublime cracking. No lyrics.',
  },
  {
    id: 'act4',
    sc: [36, 37, 38, 39, 40, 41, 42, 43, 44, 45],
    p: 'Suspense and infiltration. Blue-light archive tension, server drones, rising dread, quiet defiance. Sparse piano with electronic undercurrent. No lyrics.',
  },
  {
    id: 'act5',
    sc: [
      46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68,
      69, 70, 71, 72, 73, 74, 75,
    ],
    p: 'Climax and reckoning. Sacred machinery meets human defiance. Monumental strings, electronic chorus, then stripped silence. Resolution hanging unresolved. No lyrics.',
  },
];

async function genMusic(p: string): Promise<string | null> {
  try {
    const r = await fal.subscribe('fal-ai/stable-audio', {
      input: { prompt: p, seconds_total: 47, steps: 100 },
      logs: false,
    });
    const x = (r as any).data || r;
    return x.audio_file?.url || x.audio?.url || x.audio_url || x.url || null;
  } catch (e: any) {
    console.error(`  FAIL: ${e.message?.slice(0, 120)}`);
    return null;
  }
}

async function dl(u: string, d: string) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`DL ${r.status}`);
  fs.writeFileSync(d, Buffer.from(await r.arrayBuffer()));
}

function mix(v: string, dlg: string | undefined, sx: string, mu: string | undefined, out: string) {
  const inputs: string[] = ['-i', v, '-i', sx];
  const filters: string[] = ['[1:a]volume=0.6[s]'];
  const amix: string[] = ['[s]'];
  let idx = 2;
  if (mu && fs.existsSync(mu)) {
    inputs.push('-stream_loop', '-1', '-i', mu);
    filters.push(`[${idx}:a]volume=0.2[m]`);
    amix.push('[m]');
    idx++;
  }
  if (dlg && fs.existsSync(dlg)) {
    inputs.push('-i', dlg);
    filters.push(`[${idx}:a]volume=1.0[d]`);
    amix.push('[d]');
    idx++;
  }
  filters.push(`${amix.join('')}amix=inputs=${amix.length}:duration=first:dropout_transition=2[x]`);

  const cmd = [
    'ffmpeg',
    '-y',
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '0:v',
    '-map',
    '[x]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    out,
  ];
  execSync(cmd.map((s) => (/[\s;\[\]]/.test(s) ? `"${s}"` : s)).join(' '), {
    stdio: 'pipe',
    timeout: 60_000,
  });
}

async function main() {
  console.log('\n=== First Proof — Generate Music + Remix ===\n');

  // Generate music tracks
  const mf: Record<string, string> = {};
  for (const m of MUS) {
    const f = path.join(MUSIC, `${m.id}.mp3`);
    if (fs.existsSync(f) && fs.statSync(f).size > 10_000) {
      console.log(`[M] ${m.id}: cached`);
      mf[m.id] = f;
      continue;
    }
    console.log(`[M] Generating ${m.id}...`);
    const u = await genMusic(m.p);
    if (u) {
      try {
        await dl(u, f);
        mf[m.id] = f;
        console.log(`[M]   Done: ${m.id}`);
      } catch (e: any) {
        console.error(`[M]   DL fail: ${e.message}`);
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`\n[M] ${Object.keys(mf).length}/5 music tracks ready\n`);

  // Remix all scenes
  const sm: Record<number, string> = {};
  for (const m of MUS) if (mf[m.id]) for (const s of m.sc) sm[s] = mf[m.id];

  let ok = 0,
    fail = 0;
  for (let id = 1; id <= 75; id++) {
    const vf = path.join(VIDEOS, `${id}.mp4`);
    const df = path.join(DIALOGUE, `${id}.mp3`);
    const sf = path.join(SFX, `${id}.mp3`);
    const out = path.join(FINAL, `${id}.mp4`);
    const music = sm[id];

    if (!fs.existsSync(vf)) {
      console.log(`[${id}] no video — skip`);
      continue;
    }
    if (!fs.existsSync(sf)) {
      console.log(`[${id}] no sfx — skip`);
      continue;
    }
    if (!music) {
      console.log(`[${id}] no music for scene — skip`);
      continue;
    }

    try {
      mix(vf, fs.existsSync(df) ? df : undefined, sf, music, out);
      console.log(`[${id}] remixed`);
      ok++;
    } catch (e: any) {
      console.error(`[${id}] FAIL: ${e.message?.slice(0, 100)}`);
      fail++;
    }
  }

  console.log(`\nRemixed: ${ok} success, ${fail} failed`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
