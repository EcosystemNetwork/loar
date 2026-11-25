/**
 * Product feature switches (build-time, VITE_*).
 *
 * WORLD_BUILD_ENABLED — the 3D world-building surfaces: /world, the
 * universe World hub + set builder (/universe/$id/world/*), the wiki "3D
 * World" tab, splat environments, parts kits and restyles. Shelved until
 * the tech is ready; the code stays in place. Character 3D (model → rig →
 * animations) is not affected. Set VITE_FEATURE_WORLD_BUILD=true to bring
 * it back.
 */
export const WORLD_BUILD_ENABLED = import.meta.env.VITE_FEATURE_WORLD_BUILD === 'true';
