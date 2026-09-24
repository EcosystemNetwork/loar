import { lazy, Suspense, type ComponentProps } from 'react';
import type { Model3DThumbnail as Model3DThumbnailImpl } from './Model3DThumbnail';

// Model3DThumbnail imports @google/model-viewer + three.js (~290KB gzip). It is
// only needed for 3D cards that lack a thumbnail, so load it on first use and
// show the caller's own `fallback` (the static cube glyph) in the meantime.
const Impl = lazy(() =>
  import('./Model3DThumbnail').then((m) => ({ default: m.Model3DThumbnail }))
);

export function Model3DThumbnail(props: ComponentProps<typeof Model3DThumbnailImpl>) {
  return (
    <Suspense fallback={props.fallback}>
      <Impl {...props} />
    </Suspense>
  );
}
