import { lazy, Suspense, type ComponentProps } from 'react';
import { Loader2 } from 'lucide-react';
import type { ModelViewer as ModelViewerImpl } from './ModelViewer';

// ModelViewer pulls in @google/model-viewer + three.js (~290KB gzip). Importing
// it statically made every route that can *show* a 3D model (discover, wiki,
// galleries, lightbox…) download that up front, even with no 3D item on screen.
// Import this wrapper instead; the viewer loads only when one is first rendered.
const Impl = lazy(() => import('./ModelViewer').then((m) => ({ default: m.ModelViewer })));

export function ModelViewer(props: ComponentProps<typeof ModelViewerImpl>) {
  return (
    <Suspense
      fallback={
        <div className={`flex items-center justify-center ${props.className ?? ''}`}>
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <Impl {...props} />
    </Suspense>
  );
}
