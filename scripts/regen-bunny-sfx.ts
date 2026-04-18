/**
 * Regenerate the 24 silent SFX placeholders for Vacation Bunny
 * using FAL Stable Audio (ElevenLabs quota exhausted).
 *
 * Usage: pnpm tsx scripts/regen-bunny-sfx.ts
 * Env: FAL_KEY
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import * as fal from '@fal-ai/serverless-client';

const FK = process.env.FAL_KEY!;
if (!FK) throw new Error('FAL_KEY missing');
fal.config({ credentials: FK });

const SFX_DIR = './vacation-bunny-output/sfx';
const BATCH = parseInt(process.env.SFX_BATCH ?? '3', 10);

// Scene SFX prompts (must match the 24 silent placeholders)
const SFX: Record<string, string> = {
  S28: 'Ambient stone tower reverb, distant wind, soft medieval cave echo, quiet footsteps climbing stone stairs.',
  S29: 'Tiny footsteps on stone steps, fabric hem brushing, soft reverb, quiet ancient castle ambient.',
  S30: 'Magical slow-motion whoosh, tulle fabric billowing, sparkle shimmer chime, gentle wind breath.',
  S31: 'Panoramic mountaintop windswept ambient, distant sea breeze, warm open-sky atmosphere, airy spacious tone.',
  S32: 'Tender kiss breath, windswept stone tower, warm emotional ambient, faint sniff, peaceful wind.',
  S33: 'Magical warm glow chime, tiny metal shimmer, held emotional hush, distant wind atmosphere.',
  S34: 'Magical carousel bells, distant waltz organ, soap bubble pops, warm night seaside ambient, soft family laughter.',
  S35: 'Tiny happy running feet on stone promenade, excited breathless giggle, carousel music growing closer, bubble pops.',
  S36: 'Carousel organ music, wooden horse creaks rotating, magical twinkle chimes.',
  S37: 'Full carousel waltz organ, rhythmic wooden horse creak rising and falling, bubble pops, happy breathing, warm night.',
  S38: 'Gentle mounting carousel horse sound, soft silent laughter, continuing waltz organ, bubble pops, warm night seaside.',
  S39: 'Dreamy slow-motion whoosh, iridescent bubble chimes, carousel waltz muted distant, magical atmospheric swell.',
  S40: 'Gelato shop evening ambient, glass display case hum, metal scoops clinking, soft dusk crowd chatter, distant waves.',
  S41: 'Gelato scoop on waffle cone, soft shop interior ambient, happy tiny bunny vocalization.',
  S42: 'Soft napkin dab, warm maternal hum, gentle sigh, distant gentle ocean waves.',
  S43: 'Gentle ocean waves lapping sand, tiny metal pendant tap chime, warm seaside dusk ambient, content breath.',
  S44: 'Very quiet night apartment, distant ocean whisper through open window, soft curtain movement, peaceful silence.',
  S45: 'Tiny peaceful sleeping breath, quiet moonlit bedroom, gentle nighttime hush.',
  S51: 'Quiet older-room ambient, soft breath, warm lamp hum, peaceful silence.',
  S52: 'Delicate makeup brush whisper, soft tinkling sparkle magical sound, quiet room atmosphere.',
  S53: 'Soft magical reveal shimmer, warm maternal presence, gentle held breath, emotional piano-like note.',
  S54: 'Soft closeness breath, warm emotional piano breath, calm meaningful room ambient.',
  S55: 'Gentle sunrise ocean waves, soft sand footsteps, peaceful dawn seabird call, warm dawn breeze.',
  S56: 'Tiny metallic pendant chime touching, magical butterfly wing flutter rising, final held ambient swell, warm sustained fade.',
};

async function genSfx(prompt: string): Promise<Buffer> {
  const r = await fal.subscribe('fal-ai/stable-audio', {
    input: { prompt, seconds_total: 10, steps: 50 },
    logs: false,
  });
  const d = (r as any).data || r;
  const url = d.audio_file?.url || d.audio?.url || d.audio_url || d.url;
  if (!url) throw new Error('No URL returned');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DL ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function regen(id: string, prompt: string): Promise<boolean> {
  const dest = path.join(SFX_DIR, `${id}.mp3`);
  // Skip if we already have a real (non-placeholder) SFX: 40188 bytes = silent placeholder
  if (fs.existsSync(dest)) {
    const size = fs.statSync(dest).size;
    if (size > 500_000) {
      console.log(`[${id}] cached (${(size / 1024).toFixed(0)}KB) — skip`);
      return true;
    }
  }
  try {
    console.log(`[${id}] generating...`);
    const buf = await genSfx(prompt);
    fs.writeFileSync(dest, buf);
    console.log(`[${id}] ok (${(buf.length / 1024).toFixed(0)}KB)`);
    return true;
  } catch (err: any) {
    console.log(`[${id}] FAIL: ${err.message?.slice(0, 150)}`);
    return false;
  }
}

async function main() {
  const ids = Object.keys(SFX);
  console.log(`\n=== REGEN ${ids.length} SFX via FAL Stable Audio (batch ${BATCH}) ===\n`);
  let ok = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((id) => regen(id, SFX[id])));
    ok += results.filter(Boolean).length;
    if (i + BATCH < ids.length) await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`\n=== DONE ${ok}/${ids.length} ===`);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
