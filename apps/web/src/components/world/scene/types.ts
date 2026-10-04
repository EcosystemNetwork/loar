/** Client mirror of the server's worldSets schema (routers/world/worldSets.routes.ts). */
import type { trpcClient } from '@/utils/trpc';

export type WorldSet = Awaited<ReturnType<typeof trpcClient.worldSets.get.query>>['set'];
export type SetObject = WorldSet['objects'][number];
export type SetCamera = WorldSet['cameras'][number];
export type SetShot = WorldSet['shots'][number];
export type SetEnvironment = NonNullable<WorldSet['environment']>;
export type Vec3 = [number, number, number];

export interface CameraView {
  position: Vec3;
  target: Vec3;
  fov: number;
}

/** Imperative handle the scene exposes to the editor chrome around it. */
export interface SceneApi {
  getView(): CameraView;
  setView(view: CameraView): void;
  /** Render the current frame and return it as a PNG blob. */
  capture(): Promise<Blob>;
}
