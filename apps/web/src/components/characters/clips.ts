/**
 * Character motion clips — shapes + labels shared by the Character Studio
 * and the wiki entity page. Clips live on `entity.metadata.puppet.animations`
 * (server: services/tripo-world/pipelines.ts), one GLB per Tripo preset.
 */

export interface PuppetClip {
  preset: string;
  name: string;
  url: string;
  webUrl?: string | null;
}

export interface Puppet {
  turnaround?: Partial<Record<'front' | 'left' | 'back' | 'right', string>>;
  riggedModelUrl?: string;
  modelUrl?: string;
  webModelUrl?: string | null;
  webRiggedModelUrl?: string | null;
  thumbnailUrl?: string | null;
  rigType?: string;
  animations?: PuppetClip[];
}

export const RIG_TYPES = [
  { id: 'biped', label: 'Biped (humanoid)' },
  { id: 'quadruped', label: 'Quadruped' },
  { id: 'avian', label: 'Avian' },
  { id: 'serpentine', label: 'Serpentine' },
  { id: 'aquatic', label: 'Aquatic' },
  { id: 'hexapod', label: 'Hexapod (insect)' },
  { id: 'octopod', label: 'Octopod (spider)' },
] as const;
export type RigType = (typeof RIG_TYPES)[number]['id'];

/** Entity kinds that can be rigged (server: tripo.routes.ts PUPPET_KINDS). */
export const PUPPET_KINDS = ['person', 'species', 'vehicle'];

/** "preset:biped:wave_goodbye_01" → "Wave goodbye 1"; "preset:quadruped:walk" → "Walk". */
export function clipLabel(preset: string): string {
  const raw = preset.split(':').pop() ?? preset;
  const words = raw
    .replace(/[_-]+/g, ' ')
    .replace(/\b0+(\d)/g, '$1')
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
