/**
 * Canvas Editor — infinite-board scene composition.
 *
 * React-Flow surface. Each node is a CanvasScene (preset bundle + prompt +
 * optional generated media). Drag to reposition, click to open the inspector,
 * "Add scene" spawns a new node, edges are derived from parentId chains.
 *
 * v1: scenes persist their bundle + prompt; per-node generation triggers
 * the existing image.generateImage endpoint and writes the result URL back.
 */

import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  applyNodeChanges,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { ArrowLeft, Plus, Sparkles, Trash2, Video, Wand2 } from 'lucide-react';
import { StylePresetPicker } from '@/components/StylePresetPicker';
import { ShotPresetPicker } from '@/components/ShotPresetPicker';
import type { StylePresetId } from '@/components/style-presets';
import type { ShotPresetId } from '@/components/shot-presets';
import { STYLE_PRESETS } from '@/components/style-presets';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

export const Route = createFileRoute('/canvas/$canvasId')({
  component: CanvasEditorPage,
});

interface CanvasMeta {
  id: string;
  title: string;
  description?: string;
  visibility: 'private' | 'public';
  ownerUid: string;
}

interface CanvasScene {
  id: string;
  canvasId: string;
  parentId: string | null;
  position: { x: number; y: number };
  bundle: {
    stylePreset?: StylePresetId | null;
    shotPreset?: ShotPresetId | null;
    prompt?: string;
  };
  generatedImageUrl?: string | null;
  generatedVideoUrl?: string | null;
}

function CanvasEditorPage() {
  const { canvasId } = useParams({ from: '/canvas/$canvasId' });
  const { address } = useWalletAuth();
  const queryClient = useQueryClient();
  // ownerUid is lowercased address — derive once and compare.
  const myUid = address?.toLowerCase();
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);

  const canvasQuery = useQuery({
    queryKey: ['canvas', canvasId],
    queryFn: () => trpcClient.canvas.get.query({ id: canvasId }) as Promise<CanvasMeta>,
  });

  const scenesQuery = useQuery({
    queryKey: ['canvas', canvasId, 'scenes'],
    queryFn: () => trpcClient.canvas.listScenes.query({ canvasId }) as Promise<CanvasScene[]>,
  });

  const isOwner = !!myUid && canvasQuery.data?.ownerUid === myUid;

  const addSceneMutation = useMutation({
    mutationFn: (input: {
      canvasId: string;
      position: { x: number; y: number };
      parentId?: string | null;
    }) => trpcClient.canvas.addScene.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['canvas', canvasId, 'scenes'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to add scene'),
  });

  const updateSceneMutation = useMutation({
    mutationFn: (input: {
      id: string;
      position?: { x: number; y: number };
      bundle?: CanvasScene['bundle'];
      generatedImageUrl?: string | null;
    }) => trpcClient.canvas.updateScene.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['canvas', canvasId, 'scenes'] });
    },
  });

  const deleteSceneMutation = useMutation({
    mutationFn: (id: string) => trpcClient.canvas.deleteScene.mutate({ id }),
    onSuccess: () => {
      setSelectedSceneId(null);
      queryClient.invalidateQueries({ queryKey: ['canvas', canvasId, 'scenes'] });
    },
  });

  // Convert scenes → react-flow nodes/edges
  const initialNodes: Node<CanvasScene>[] = useMemo(
    () =>
      (scenesQuery.data ?? []).map((scene) => ({
        id: scene.id,
        type: 'scene',
        position: scene.position,
        data: scene,
        draggable: isOwner,
      })),
    [scenesQuery.data, isOwner]
  );

  const edges: Edge[] = useMemo(
    () =>
      (scenesQuery.data ?? [])
        .filter((s) => s.parentId)
        .map((s) => ({
          id: `${s.parentId}-${s.id}`,
          source: s.parentId!,
          target: s.id,
          animated: false,
        })),
    [scenesQuery.data]
  );

  // Local node state for smooth dragging; persist on drag stop
  const [nodes, setNodes] = useState<Node<CanvasScene>[]>(initialNodes);
  useEffect(() => setNodes(initialNodes), [initialNodes]);

  const pendingPositionRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          pendingPositionRef.current.set(change.id, change.position);
          updateSceneMutation.mutate({ id: change.id, position: change.position });
        }
      }
    },
    [updateSceneMutation]
  );

  const handleAddScene = useCallback(
    (parentId: string | null = null) => {
      // Place new scenes to the right of their parent (or center if root)
      const parent = parentId ? nodes.find((n) => n.id === parentId) : null;
      const position = parent
        ? { x: parent.position.x + 320, y: parent.position.y }
        : { x: 100 + nodes.length * 40, y: 100 + nodes.length * 40 };
      addSceneMutation.mutate({ canvasId, position, parentId });
    },
    [nodes, canvasId, addSceneMutation]
  );

  const selectedScene = useMemo(
    () => scenesQuery.data?.find((s) => s.id === selectedSceneId) ?? null,
    [scenesQuery.data, selectedSceneId]
  );

  // Per-node image generation — call existing image.generateImage with bundled prompt
  const generateImageForScene = useCallback(async (scene: CanvasScene) => {
    const prompt = scene.bundle.prompt?.trim();
    if (!prompt) throw new Error(`Scene "${scene.id}" has no prompt`);
    const result: any = await trpcClient.image.generateImage.mutate({
      prompt,
      model: 'fal-ai/nano-banana',
      imageSize: 'landscape_16_9',
      numImages: 1,
      stylePreset: scene.bundle.stylePreset ?? null,
    });
    if (result.status !== 'completed' || !result.imageUrl) {
      throw new Error(result.error || 'Image generation failed');
    }
    await trpcClient.canvas.updateScene.mutate({
      id: scene.id,
      generatedImageUrl: result.imageUrl,
    });
    return result.imageUrl as string;
  }, []);

  const generateMutation = useMutation({
    mutationFn: (scene: CanvasScene) => generateImageForScene(scene),
    onSuccess: () => {
      toast.success('Scene generated');
      queryClient.invalidateQueries({ queryKey: ['canvas', canvasId, 'scenes'] });
    },
    onError: (err: any) => toast.error(err.message || 'Generation failed'),
  });

  // Video generation — needs scene's own image OR (for continuation) parent's image
  const generateVideoMutation = useMutation({
    mutationFn: async ({
      scene,
      sourceImageUrl,
    }: {
      scene: CanvasScene;
      sourceImageUrl: string;
    }) => {
      const prompt = scene.bundle.prompt?.trim();
      if (!prompt) throw new Error('Add a prompt to this scene first');
      const result: any = await trpcClient.generation.veo3ImageToVideo.mutate({
        prompt,
        imageUrl: sourceImageUrl,
        duration: 5,
        aspectRatio: '16:9',
        motionStrength: 127,
        stylePreset: scene.bundle.stylePreset ?? null,
      });
      if (!result.videoUrl) {
        throw new Error(result.error || 'Video generation failed');
      }
      await trpcClient.canvas.updateScene.mutate({
        id: scene.id,
        generatedVideoUrl: result.videoUrl,
      });
      return result.videoUrl as string;
    },
    onSuccess: () => {
      toast.success('Video generated');
      queryClient.invalidateQueries({ queryKey: ['canvas', canvasId, 'scenes'] });
    },
    onError: (err: any) => toast.error(err.message || 'Video gen failed'),
  });

  // Batch — image-gen every scene that has a prompt but no image yet
  const batchGenerateMutation = useMutation({
    mutationFn: async () => {
      const all = scenesQuery.data ?? [];
      const todo = all.filter((s) => s.bundle.prompt?.trim() && !s.generatedImageUrl);
      if (todo.length === 0) {
        throw new Error('No scenes need image generation');
      }
      let done = 0;
      let failed = 0;
      for (const scene of todo) {
        try {
          await generateImageForScene(scene);
          done++;
          // Refetch between iterations so the UI fills in progressively
          await queryClient.invalidateQueries({
            queryKey: ['canvas', canvasId, 'scenes'],
          });
        } catch (e) {
          failed++;
          // Continue past failures so a single bad prompt doesn't stop the batch
        }
      }
      return { done, failed, total: todo.length };
    },
    onSuccess: ({ done, failed, total }) => {
      if (failed === 0) {
        toast.success(`Generated ${done}/${total} scenes`);
      } else {
        toast.warning(`Generated ${done}/${total}, ${failed} failed`);
      }
    },
    onError: (err: any) => toast.error(err.message || 'Batch failed'),
  });

  if (canvasQuery.isLoading) {
    return <div className="p-8 text-muted-foreground">Loading canvas…</div>;
  }
  if (canvasQuery.isError || !canvasQuery.data) {
    return (
      <div className="p-8 space-y-3">
        <p className="text-red-500">Canvas not found or inaccessible.</p>
        <Link to="/canvas" className="text-sm text-primary hover:underline">
          ← Back to canvases
        </Link>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col">
      {/* Toolbar */}
      <header className="border-b px-4 py-2 flex items-center gap-3">
        <Link
          to="/canvas"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" />
          Canvases
        </Link>
        <div className="h-4 w-px bg-border" />
        <h1 className="font-medium text-sm">{canvasQuery.data.title}</h1>
        <span className="text-[10px] uppercase text-muted-foreground">
          {canvasQuery.data.visibility}
        </span>
        <div className="flex-1" />
        {isOwner && (
          <>
            <button
              onClick={() => batchGenerateMutation.mutate()}
              disabled={batchGenerateMutation.isPending}
              className="text-xs px-2 py-1 rounded border flex items-center gap-1 disabled:opacity-50"
              title="Generate images for every scene that has a prompt but no image"
            >
              <Wand2 className="h-3 w-3" />
              {batchGenerateMutation.isPending ? 'Generating…' : 'Generate all'}
            </button>
            <button
              onClick={() => handleAddScene(null)}
              disabled={addSceneMutation.isPending}
              className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground flex items-center gap-1 disabled:opacity-50"
            >
              <Plus className="h-3 w-3" />
              Add scene
            </button>
          </>
        )}
      </header>

      {/* Canvas + inspector */}
      <div className="flex-1 flex">
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            nodeTypes={NODE_TYPES}
            onNodeClick={(_, node) => setSelectedSceneId(node.id)}
            fitView
            minZoom={0.2}
            maxZoom={1.8}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        {selectedScene && (
          <aside className="w-80 border-l overflow-y-auto p-4 space-y-3 bg-background">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Scene</h2>
              <button
                onClick={() => setSelectedSceneId(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>

            {isOwner ? (
              <SceneInspector
                scene={selectedScene}
                parentScene={
                  selectedScene.parentId
                    ? (scenesQuery.data?.find((s) => s.id === selectedScene.parentId) ?? null)
                    : null
                }
                onUpdate={(patch) => updateSceneMutation.mutate({ id: selectedScene.id, ...patch })}
                onBranch={() => handleAddScene(selectedScene.id)}
                onDelete={() => deleteSceneMutation.mutate(selectedScene.id)}
                onGenerate={() => generateMutation.mutate(selectedScene)}
                onGenerateVideo={(sourceImageUrl) =>
                  generateVideoMutation.mutate({ scene: selectedScene, sourceImageUrl })
                }
                generating={generateMutation.isPending}
                generatingVideo={generateVideoMutation.isPending}
              />
            ) : (
              <SceneReadOnly scene={selectedScene} />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

// ── Scene Node ────────────────────────────────────────────────────────

function SceneNode({ data, selected }: NodeProps<CanvasScene>) {
  const swatchColor = data.bundle.stylePreset
    ? STYLE_PRESETS.find((s) => s.id === data.bundle.stylePreset)?.color
    : null;

  return (
    <div
      className={`w-56 border-2 rounded bg-background overflow-hidden shadow-sm transition-shadow ${
        selected ? 'border-primary shadow-md' : 'border-border'
      }`}
    >
      <Handle type="target" position={Position.Top} />
      {data.generatedImageUrl ? (
        <img
          src={resolveIpfsUrl(data.generatedImageUrl)}
          alt="Scene"
          className="w-full h-28 object-cover"
        />
      ) : (
        <div
          className="w-full h-28 flex items-center justify-center text-[10px] text-muted-foreground"
          style={{
            background: swatchColor
              ? `linear-gradient(135deg, ${swatchColor}, ${swatchColor}aa)`
              : undefined,
          }}
        >
          {swatchColor ? '' : 'No image yet'}
        </div>
      )}
      <div className="p-2 space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex gap-1">
          {data.bundle.stylePreset && (
            <span className="px-1.5 py-0.5 rounded bg-muted text-foreground/80 truncate max-w-[80px]">
              {data.bundle.stylePreset}
            </span>
          )}
          {data.bundle.shotPreset && (
            <span className="px-1.5 py-0.5 rounded bg-muted text-foreground/80 truncate max-w-[80px]">
              {data.bundle.shotPreset}
            </span>
          )}
        </div>
        <p className="text-xs text-foreground line-clamp-3">
          {data.bundle.prompt || <span className="text-muted-foreground italic">No prompt</span>}
        </p>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const NODE_TYPES = { scene: SceneNode };

// ── Inspector ─────────────────────────────────────────────────────────

function SceneInspector({
  scene,
  parentScene,
  onUpdate,
  onBranch,
  onDelete,
  onGenerate,
  onGenerateVideo,
  generating,
  generatingVideo,
}: {
  scene: CanvasScene;
  parentScene: CanvasScene | null;
  onUpdate: (patch: { bundle?: CanvasScene['bundle'] }) => void;
  onBranch: () => void;
  onDelete: () => void;
  onGenerate: () => void;
  onGenerateVideo: (sourceImageUrl: string) => void;
  generating: boolean;
  generatingVideo: boolean;
}) {
  const [prompt, setPrompt] = useState(scene.bundle.prompt ?? '');
  const [stylePreset, setStylePreset] = useState<StylePresetId | null>(
    scene.bundle.stylePreset ?? null
  );
  const [shotPreset, setShotPreset] = useState<ShotPresetId | null>(
    scene.bundle.shotPreset ?? null
  );

  // Re-sync when scene changes (different node clicked)
  useEffect(() => {
    setPrompt(scene.bundle.prompt ?? '');
    setStylePreset(scene.bundle.stylePreset ?? null);
    setShotPreset(scene.bundle.shotPreset ?? null);
  }, [scene.id]);

  const dirty =
    prompt !== (scene.bundle.prompt ?? '') ||
    stylePreset !== (scene.bundle.stylePreset ?? null) ||
    shotPreset !== (scene.bundle.shotPreset ?? null);

  const handleSave = () => {
    onUpdate({
      bundle: {
        prompt: prompt || undefined,
        stylePreset,
        shotPreset,
      },
    });
    toast.success('Scene saved');
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs text-muted-foreground">Prompt</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          className="mt-1 w-full text-sm px-2 py-1.5 rounded border bg-background"
          placeholder="Describe this scene…"
        />
      </label>

      <StylePresetPicker value={stylePreset} onChange={setStylePreset} compact />
      <ShotPresetPicker value={shotPreset} onChange={setShotPreset} />

      <div className="flex gap-1.5">
        <button
          onClick={handleSave}
          disabled={!dirty}
          className="flex-1 px-2 py-1.5 rounded bg-primary text-primary-foreground text-xs disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={onGenerate}
          disabled={generating || !prompt.trim()}
          className="px-2 py-1.5 rounded border text-xs flex items-center gap-1 disabled:opacity-50"
          title="Generate image for this scene"
        >
          <Sparkles className="h-3 w-3" />
          {generating ? 'Generating…' : 'Generate'}
        </button>
      </div>

      <div className="pt-2 border-t flex gap-1.5">
        <button
          onClick={onBranch}
          className="flex-1 px-2 py-1.5 rounded border text-xs"
          title="Add a child scene branching off this one"
        >
          + Branch from here
        </button>
        <button
          onClick={() => {
            if (confirm('Delete this scene?')) onDelete();
          }}
          className="px-2 py-1.5 rounded border border-red-500/40 text-red-500 text-xs"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function SceneReadOnly({ scene }: { scene: CanvasScene }) {
  return (
    <div className="space-y-3 text-sm">
      {scene.bundle.prompt && (
        <div>
          <span className="text-xs text-muted-foreground">Prompt</span>
          <p className="mt-1">{scene.bundle.prompt}</p>
        </div>
      )}
      {scene.bundle.stylePreset && (
        <div className="text-xs">
          <span className="text-muted-foreground">Style:</span> {scene.bundle.stylePreset}
        </div>
      )}
      {scene.bundle.shotPreset && (
        <div className="text-xs">
          <span className="text-muted-foreground">Shot:</span> {scene.bundle.shotPreset}
        </div>
      )}
    </div>
  );
}
