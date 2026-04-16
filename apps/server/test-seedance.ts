import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

import { bytedanceService } from './src/services/bytedance.js';

async function main() {
  console.log('🎬 Testing ByteDance Seedance 2.0 — Crystalline Dominion');
  console.log('API Key configured:', !!process.env.BYTEDANCE_API_KEY);

  const result = await bytedanceService.generateVideo({
    prompt:
      'A sweeping aerial shot over the Crystalline Dominion. Vast crystalline cities float among swirling nebula clouds, their surfaces refracting prismatic light into rainbow cascades. Ancient glowing runes carved into massive asteroid rings pulse with ethereal energy. Beings of pure radiant light clash with shadow creatures in an eternal cosmic struggle for dominion over reality. Camera slowly pushes through crystalline spires as energy beams arc across the void. Cinematic, epic scale, volumetric god rays.',
    model: 'dreamina-seedance-2-0-260128',
    mode: 'text_to_video',
    duration: 8,
    aspectRatio: '16:9',
    resolution: '720p',
    audio: true,
  });

  console.log('\nResult:', JSON.stringify(result, null, 2));

  if (result.videoUrl) {
    console.log('\n✅ VIDEO URL:', result.videoUrl);
  } else {
    console.log('\n❌ Generation failed:', result.error);
  }
}

main().catch(console.error);
