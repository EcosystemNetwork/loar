/**
 * Gaussian-splat environment (Tripo image-to-splat output) rendered with
 * Spark. One SparkRenderer per scene; the SplatMesh is a plain Object3D.
 *
 * Our stored URLs are IPFS gateway links without a file extension, so the
 * file type is passed explicitly from the job's recorded format. They point at
 * our token-gated dedicated gateway, and Spark fetches inside a worker that
 * the global IPFS fallback can't reach — so resolve to an authenticated URL
 * before handing it over, or the worker gets a 401.
 */
import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { SparkRenderer, SplatMesh, SplatFileType } from '@sparkjsdev/spark';
import { primeIpfsGatewayConfig, resolveIpfsUrlAsync } from '@/utils/ipfs-url';
import type { Vec3 } from './types';

const FILE_TYPES: Record<string, SplatFileType> = {
  ply: SplatFileType.PLY,
  spz: SplatFileType.SPZ,
  splat: SplatFileType.SPLAT,
  ksplat: SplatFileType.KSPLAT,
};

export function splatFileType(format: string | undefined): SplatFileType | undefined {
  return format ? FILE_TYPES[format.toLowerCase()] : undefined;
}

export function SplatEnvironment({
  url,
  format,
  position = [0, 0, 0],
  rotationY = 0,
  scale = 1,
}: {
  url: string;
  format?: string;
  position?: Vec3;
  rotationY?: number;
  scale?: number;
}) {
  const { gl, scene } = useThree();

  useEffect(() => {
    const spark = new SparkRenderer({ renderer: gl });
    scene.add(spark);
    return () => {
      scene.remove(spark);
      (spark as unknown as { dispose?: () => void }).dispose?.();
    };
  }, [gl, scene]);

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setResolvedUrl(null);
    // The dedicated host is only recognised once the gateway config is primed.
    void primeIpfsGatewayConfig()
      .then(() => resolveIpfsUrlAsync(url))
      .then((u) => {
        if (!cancelled) setResolvedUrl(u || url);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const mesh = useMemo(
    () =>
      resolvedUrl
        ? new SplatMesh({
            url: resolvedUrl,
            fileType: splatFileType(format),
            fileName: `env.${format ?? 'ply'}`,
          })
        : null,
    [resolvedUrl, format]
  );
  useEffect(() => () => mesh?.dispose(), [mesh]);

  if (!mesh) return null;

  // 3DGS captures are conventionally Y-down; flip about X so the scene stands upright.
  return (
    <primitive object={mesh} position={position} rotation={[Math.PI, rotationY, 0]} scale={scale} />
  );
}
