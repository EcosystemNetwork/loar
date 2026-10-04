/**
 * Which 3D provider runs a generation / rig / remesh.
 *
 * Both Meshy and Tripo3D are BYOK-only, so the choice follows the keys the
 * user has on file:
 *   - `tripo` → the user's Tripo key, or a FORBIDDEN carrying
 *               NoKeyAvailableError (the web's "add a key" modal keys on it).
 *   - `meshy` → Meshy, exactly as before this option existed.
 *   - `auto`  → Tripo when the user has a Tripo key, otherwise Meshy. Tripo
 *               covers more (every rig type, quad remesh, game-ready P1
 *               topology), so it wins when both keys are present.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { NoKeyAvailableError } from '../services/provider-keys/types';
import { tripo3dService, type TripoRigType, type TripoTask } from '../services/tripo3d';

export const threedProviderSchema = z.enum(['auto', 'meshy', 'tripo']).default('auto');
export type ThreedProviderChoice = z.infer<typeof threedProviderSchema>;

export type PickedThreedProvider =
  | { provider: 'meshy'; tripoApiKey?: undefined }
  | { provider: 'tripo'; tripoApiKey: string };

/** Resolve the caller's Tripo key or throw the "add a key" FORBIDDEN. */
export async function requireTripoApiKey(
  uid: string,
  message = 'Add your Tripo3D API key at /settings/api-keys to use Tripo3D.'
): Promise<string> {
  const { resolveProviderKey } = await import('./byok');
  const key = await resolveProviderKey(uid, 'tripo');
  if (!key) {
    const cause = new NoKeyAvailableError('tripo', message);
    throw new TRPCError({ code: 'FORBIDDEN', message: cause.message, cause });
  }
  return key;
}

export async function pickThreedProvider(
  uid: string,
  choice: ThreedProviderChoice = 'auto'
): Promise<PickedThreedProvider> {
  if (choice === 'meshy') return { provider: 'meshy' };
  if (choice === 'tripo') return { provider: 'tripo', tripoApiKey: await requireTripoApiKey(uid) };
  const { resolveProviderKey } = await import('./byok');
  const key = await resolveProviderKey(uid, 'tripo');
  return key ? { provider: 'tripo', tripoApiKey: key } : { provider: 'meshy' };
}

/** The mesh URL a finished Tripo task produced (signed — rehost before persisting). */
export function tripoTaskModelUrl(task: TripoTask): string | undefined {
  return task.output?.model_url || task.output?.model_urls?.[0];
}

const RIG_TYPES: readonly TripoRigType[] = [
  'biped',
  'quadruped',
  'hexapod',
  'octopod',
  'avian',
  'serpentine',
  'aquatic',
  'others',
];

/** Map rig-check's verdict onto our rig enum; anything unrecognised rigs generically. */
export function normalizeTripoRigType(raw: string | undefined): TripoRigType {
  const v = (raw ?? '').toLowerCase().trim();
  if ((RIG_TYPES as readonly string[]).includes(v)) return v as TripoRigType;
  if (v === 'humanoid' || v === 'human') return 'biped';
  return 'others';
}

/**
 * Ask Tripo what skeleton a mesh needs (humanoid, quadruped, spider, snake…).
 * `input` is a file token or a prior task id. Throws when the mesh can't be
 * rigged at all, so a bad mesh fails before the user pays for a rig.
 */
export async function detectTripoRigType(input: string, apiKey: string): Promise<TripoRigType> {
  const { taskId } = await tripo3dService.rigCheck({ input, apiKey });
  const task = await tripo3dService.waitForTask(taskId, 3 * 60 * 1000, 3000, apiKey);
  if (task.output?.riggable === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Tripo3D says this model cannot be rigged — try a cleaner, single-object mesh.',
    });
  }
  return normalizeTripoRigType(task.output?.rig_type);
}
