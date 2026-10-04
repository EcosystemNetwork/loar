/**
 * One placed asset in a set: loads its GLB, optionally isolates a single
 * named part (parts kits from tripo.segment), re-grounds it so its base
 * sits on y=0 at its own origin, and loops its baked animation when asked.
 */
import { useEffect, useMemo } from 'react';
import { useAnimations, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { resolveIpfsUrlPreferred } from '@/utils/ipfs-url';

export function assetUrl(url: string): string {
  return resolveIpfsUrlPreferred(url) || url;
}

export function SetObjectModel({
  url,
  partName,
  playing = false,
  visible = true,
}: {
  url: string;
  partName?: string | null;
  playing?: boolean;
  visible?: boolean;
}) {
  const gltf = useGLTF(assetUrl(url));

  const root = useMemo(() => {
    const source = (partName && gltf.scene.getObjectByName(partName)) || gltf.scene;
    // SkeletonUtils.clone keeps skinned meshes bound to their (cloned) bones,
    // so the same GLB can be placed several times and animate independently.
    const model = SkeletonUtils.clone(source);
    if (partName) {
      model.position.set(0, 0, 0);
      model.rotation.set(0, 0, 0);
    }
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    const box = new THREE.Box3().setFromObject(model);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= box.min.y;
    }
    const group = new THREE.Group();
    group.add(model);
    return group;
  }, [gltf.scene, partName]);

  const { actions, names } = useAnimations(gltf.animations, root);
  useEffect(() => {
    const action = names[0] ? actions[names[0]] : null;
    if (!action || !playing) return;
    action.reset().fadeIn(0.2).play();
    return () => {
      action.fadeOut(0.2);
    };
  }, [actions, names, playing]);

  return <primitive object={root} visible={visible} />;
}

/** Placeholder while a GLB streams in. */
export function LoadingBox() {
  return (
    <mesh position={[0, 0.5, 0]}>
      <boxGeometry args={[0.6, 1, 0.6]} />
      <meshBasicMaterial wireframe color="#888" />
    </mesh>
  );
}
