/**
 * WorldScene — the R3F canvas behind the set builder (#4) and explore
 * mode (#7).
 *
 *  edit:    orbit camera, ground grid, click to select, gizmo to move /
 *           rotate / scale; the editor reads and drives the camera through
 *           `apiRef` (save angles, capture shots).
 *  explore: third-person walk. The set's player object (a rigged puppet)
 *           plays its idle/walk/run clips; WASD/arrows move, Shift runs.
 *           Linked objects show a label and open their episode/wiki page.
 */
import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { SplatEnvironment } from './SplatEnvironment';
import { LoadingBox, SetObjectModel } from './SetObjectModel';
import type { CameraView, SceneApi, SetEnvironment, SetObject, Vec3 } from './types';

export type SceneMode = 'edit' | 'explore';
export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface WorldSceneProps {
  mode: SceneMode;
  environment: SetEnvironment | null;
  objects: SetObject[];
  spawn: Vec3;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onTransform?: (id: string, t: Pick<SetObject, 'position' | 'rotationY' | 'scale'>) => void;
  transformMode?: TransformMode;
  apiRef?: MutableRefObject<SceneApi | null>;
  onLink?: (link: NonNullable<SetObject['link']>) => void;
  className?: string;
}

export function WorldScene(props: WorldSceneProps) {
  return (
    <Canvas
      className={props.className}
      shadows
      dpr={[1, 2]}
      // Shots are read back from the drawing buffer.
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ position: [4, 3, 6], fov: 45, near: 0.05, far: 2000 }}
      onPointerMissed={() => props.mode === 'edit' && props.onSelect?.(null)}
    >
      <color attach="background" args={['#0d0f14']} />
      <hemisphereLight args={['#dfe8ff', '#2a2420', 0.9]} />
      <directionalLight
        position={[6, 10, 4]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      {props.environment?.splatUrl && (
        <Suspense fallback={null}>
          <SplatEnvironment
            url={props.environment.splatUrl}
            format={props.environment.format}
            position={props.environment.position as Vec3}
            rotationY={props.environment.rotationY}
            scale={props.environment.scale}
          />
        </Suspense>
      )}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <shadowMaterial opacity={0.35} />
      </mesh>
      {props.mode === 'edit' ? <EditLayer {...props} /> : <ExploreLayer {...props} />}
      {props.apiRef && <SceneApiBridge apiRef={props.apiRef} />}
    </Canvas>
  );
}

// ── Edit mode ────────────────────────────────────────────────────────────

function EditLayer({
  objects,
  selectedId,
  onSelect,
  onTransform,
  transformMode = 'translate',
}: WorldSceneProps) {
  return (
    <>
      <OrbitControls makeDefault enableDamping target={[0, 0.8, 0]} />
      <Grid
        infiniteGrid
        cellSize={0.5}
        sectionSize={5}
        fadeDistance={60}
        cellColor="#2b3140"
        sectionColor="#3d4660"
      />
      {objects.map((o) => {
        const node = (
          <group
            key={o.id}
            position={o.position as Vec3}
            rotation-y={o.rotationY}
            scale={o.scale}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(o.id);
            }}
          >
            <Suspense fallback={<LoadingBox />}>
              <SetObjectModel url={o.url} partName={o.partName} />
            </Suspense>
          </group>
        );
        if (o.id !== selectedId) return node;
        return (
          <TransformControls
            key={o.id}
            mode={transformMode}
            showX={transformMode !== 'rotate'}
            showZ={transformMode !== 'rotate'}
            position={o.position as Vec3}
            rotation={[0, o.rotationY, 0]}
            scale={o.scale}
            onMouseUp={(e) => {
              const obj = (e?.target as unknown as { object?: THREE.Object3D })?.object;
              if (!obj) return;
              onTransform?.(o.id, {
                position: [obj.position.x, Math.max(0, obj.position.y), obj.position.z],
                rotationY: obj.rotation.y,
                // Uniform scale only — the gizmo's largest axis wins.
                scale: Math.max(0.01, Math.max(obj.scale.x, obj.scale.y, obj.scale.z)),
              });
            }}
          >
            <group>
              <Suspense fallback={<LoadingBox />}>
                <SetObjectModel url={o.url} partName={o.partName} />
              </Suspense>
            </group>
          </TransformControls>
        );
      })}
    </>
  );
}

// ── Explore mode ─────────────────────────────────────────────────────────

const WALK_SPEED = 1.6;
const RUN_SPEED = 4;
const TURN_SPEED = 2.4;
const LINK_RADIUS = 3;

function useKeys() {
  const keys = useRef(new Set<string>());
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]')) return;
      keys.current.add(e.key.toLowerCase());
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const clear = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, []);
  return keys;
}

/** Pick the clip URL for a locomotion state from a puppet's animation list. */
function clipFor(o: SetObject, state: 'idle' | 'walk' | 'run'): string | null {
  const clips = o.animations ?? [];
  const find = (n: string) => clips.find((c) => c.name.toLowerCase().includes(n))?.url ?? null;
  if (state === 'run') return find('run') ?? find('walk') ?? find('march') ?? find('idle');
  if (state === 'walk') return find('walk') ?? find('march') ?? find('idle');
  return find('idle');
}

function ExploreLayer({ objects, spawn, onLink }: WorldSceneProps) {
  const player = objects.find((o) => o.isPlayer) ?? null;
  const props = objects.filter((o) => o !== player);
  const keys = useKeys();
  const playerRef = useRef<THREE.Group>(null);
  const [motion, setMotion] = useState<'idle' | 'walk' | 'run'>('idle');
  const [nearLink, setNearLink] = useState<string | null>(null);
  const heading = useRef(player ? player.rotationY : 0);
  const pos = useRef(
    new THREE.Vector3(...((player?.position as Vec3 | undefined) ?? (spawn as Vec3)))
  );
  const { camera } = useThree();
  const linked = useMemo(() => props.filter((o) => o.link), [props]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'e' || !nearLink) return;
      const o = linked.find((x) => x.id === nearLink);
      if (o?.link) onLink?.(o.link);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nearLink, linked, onLink]);

  useFrame((_, dt) => {
    const k = keys.current;
    const fwd =
      (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const turn =
      (k.has('a') || k.has('arrowleft') ? 1 : 0) - (k.has('d') || k.has('arrowright') ? 1 : 0);
    const running = k.has('shift');
    heading.current += turn * TURN_SPEED * dt;
    const speed = fwd * (running ? RUN_SPEED : WALK_SPEED);
    pos.current.x += Math.sin(heading.current) * speed * dt;
    pos.current.z += Math.cos(heading.current) * speed * dt;

    const next = fwd === 0 ? 'idle' : running ? 'run' : 'walk';
    if (next !== motion) setMotion(next);

    if (playerRef.current) {
      playerRef.current.position.copy(pos.current);
      playerRef.current.rotation.y = heading.current;
    }
    // Third-person follow camera (first-person-ish when there is no player).
    const back = player ? 4.5 : 0.01;
    const height = player ? 2.4 : 1.6;
    const desired = new THREE.Vector3(
      pos.current.x - Math.sin(heading.current) * back,
      pos.current.y + height,
      pos.current.z - Math.cos(heading.current) * back
    );
    camera.position.lerp(desired, Math.min(1, dt * 6));
    camera.lookAt(
      pos.current.x + Math.sin(heading.current) * (player ? 0 : 5),
      pos.current.y + (player ? 1.2 : 1.5),
      pos.current.z + Math.cos(heading.current) * (player ? 0 : 5)
    );

    let closest: string | null = null;
    let best = LINK_RADIUS;
    for (const o of linked) {
      const d = pos.current.distanceTo(new THREE.Vector3(...(o.position as Vec3)));
      if (d < best) {
        best = d;
        closest = o.id;
      }
    }
    if (closest !== nearLink) setNearLink(closest);
  });

  const states = ['idle', 'walk', 'run'] as const;
  const clipUrls = player
    ? Array.from(new Set(states.map((s) => clipFor(player, s)).filter((u): u is string => !!u)))
    : [];
  const activeClip = player ? clipFor(player, motion) : null;

  return (
    <>
      {props.map((o) => {
        const idle = o.animations?.length ? clipFor(o, 'idle') : null;
        return (
          <group key={o.id} position={o.position as Vec3} rotation-y={o.rotationY} scale={o.scale}>
            <Suspense fallback={null}>
              <SetObjectModel url={idle ?? o.url} partName={o.partName} playing={!!idle} />
            </Suspense>
            {o.link && (
              <Html position={[0, 2.2 / Math.max(o.scale, 0.01), 0]} center distanceFactor={8}>
                <button
                  type="button"
                  onClick={() => onLink?.(o.link!)}
                  className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium shadow-lg transition ${
                    nearLink === o.id
                      ? 'bg-primary text-primary-foreground scale-110'
                      : 'bg-background/80 text-foreground'
                  }`}
                >
                  {o.link.label || o.label}
                  {nearLink === o.id && <span className="ml-1 opacity-70">· E</span>}
                </button>
              </Html>
            )}
          </group>
        );
      })}
      {player && (
        <group ref={playerRef} scale={player.scale}>
          <Suspense fallback={<LoadingBox />}>
            {clipUrls.length ? (
              clipUrls.map((u) => (
                <SetObjectModel
                  key={u}
                  url={u}
                  playing={u === activeClip}
                  visible={u === activeClip}
                />
              ))
            ) : (
              <SetObjectModel url={player.url} partName={player.partName} />
            )}
          </Suspense>
        </group>
      )}
    </>
  );
}

// ── Camera / capture bridge ──────────────────────────────────────────────

function SceneApiBridge({ apiRef }: { apiRef: MutableRefObject<SceneApi | null> }) {
  const { camera, gl, scene, controls } = useThree();
  useEffect(() => {
    const orbit = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    apiRef.current = {
      getView(): CameraView {
        const target = orbit?.target ?? new THREE.Vector3(0, 0.8, 0);
        return {
          position: camera.position.toArray() as Vec3,
          target: target.toArray() as Vec3,
          fov: (camera as THREE.PerspectiveCamera).fov ?? 45,
        };
      },
      setView(view) {
        camera.position.set(...view.position);
        const persp = camera as THREE.PerspectiveCamera;
        if (persp.isPerspectiveCamera) {
          persp.fov = view.fov;
          persp.updateProjectionMatrix();
        }
        if (orbit?.target) {
          orbit.target.set(...view.target);
          orbit.update?.();
        } else {
          camera.lookAt(...view.target);
        }
      },
      capture() {
        gl.render(scene, camera);
        return new Promise((resolve, reject) =>
          gl.domElement.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Could not capture the frame'))),
            'image/png'
          )
        );
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, camera, gl, scene, controls]);
  return null;
}
