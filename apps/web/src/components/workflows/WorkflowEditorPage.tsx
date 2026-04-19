import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import { ShoppingCart, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Link } from '@tanstack/react-router';
import {
  useArchiveWorkflow,
  useEstimateCost,
  useHasLicense,
  usePurchaseWorkflow,
  useRunWorkflow,
  useUpdateWorkflow,
  useWorkflow,
} from '@/hooks/useWorkflows';
import { useWalletAccount } from '@/hooks/useWalletAccount';
import { WorkflowCanvas } from './WorkflowCanvas';
import { NodePalette } from './NodePalette';
import { NodeInspector } from './NodeInspector';
import { RunPanel } from './RunPanel';
import { PublishDialog, type Visibility } from './PublishDialog';
import type { AnyNodeParams } from './node-types';

const AUTOSAVE_DELAY_MS = 1500;

export function WorkflowEditorPage({ workflowId }: { workflowId: string }) {
  const { data: workflow, isLoading } = useWorkflow(workflowId);
  const update = useUpdateWorkflow();
  const archive = useArchiveWorkflow();
  const runMutation = useRunWorkflow();
  const cost = useEstimateCost(workflowId);
  const { address } = useWalletAccount();
  const isOwner =
    !!workflow && !!address && workflow.ownerUid.toLowerCase() === address.toLowerCase();
  const { data: licenseData } = useHasLicense(
    workflow && workflow.visibility === 'paid' && !isOwner ? workflowId : undefined
  );
  const purchase = usePurchaseWorkflow();

  const [name, setName] = useState('');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeNodeIds, setActiveNodeIds] = useState<string[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const initialized = useRef(false);
  const saveTimer = useRef<number | null>(null);

  // Hydrate state once when the workflow doc arrives
  useEffect(() => {
    if (!workflow || initialized.current) return;
    setName(workflow.name);
    setNodes(
      workflow.graph.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data as AnyNodeParams,
      }))
    );
    setEdges(
      workflow.graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      }))
    );
    initialized.current = true;
  }, [workflow]);

  // Debounced auto-save on graph or name change
  const queueSave = useCallback(
    (patch: Parameters<typeof update.mutate>[0]) => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        update.mutate(patch, {
          onSuccess: () => setSavedAt(Date.now()),
          onError: (err: any) => toast.error(err?.message ?? 'Save failed'),
        });
      }, AUTOSAVE_DELAY_MS);
    },
    [update]
  );

  const onCanvasChange = useCallback(
    (newNodes: Node[], newEdges: Edge[]) => {
      setNodes(newNodes);
      setEdges(newEdges);
      if (!initialized.current) return;
      queueSave({
        id: workflowId,
        graph: {
          nodes: newNodes.map((n) => ({
            id: n.id,
            type: n.type as 'prompt' | 'ref' | 'animate' | 'upscale',
            position: n.position,
            data: n.data,
          })),
          edges: newEdges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle ?? null,
            targetHandle: e.targetHandle ?? null,
          })),
        },
      });
    },
    [queueSave, workflowId]
  );

  const onNameBlur = useCallback(() => {
    if (workflow && name && name !== workflow.name) {
      queueSave({ id: workflowId, name });
    }
  }, [workflow, name, queueSave, workflowId]);

  const updateNode = useCallback(
    (nodeId: string, patch: Partial<AnyNodeParams>) => {
      setNodes((current) => {
        const next = current.map((n) =>
          n.id === nodeId ? { ...n, data: { ...(n.data as object), ...patch } } : n
        );
        // queue save with the new graph
        queueSave({
          id: workflowId,
          graph: {
            nodes: next.map((n) => ({
              id: n.id,
              type: n.type as 'prompt' | 'ref' | 'animate' | 'upscale',
              position: n.position,
              data: n.data,
            })),
            edges: edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              sourceHandle: e.sourceHandle ?? null,
              targetHandle: e.targetHandle ?? null,
            })),
          },
        });
        return next;
      });
    },
    [edges, queueSave, workflowId]
  );

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNodeId(null);
  }, []);

  const onPublish = useCallback(
    (patch: {
      visibility: Visibility;
      collaboratorUids: string[];
      priceCredits: number;
      universeAddress: string | null;
    }) => {
      update.mutate(
        {
          id: workflowId,
          visibility: patch.visibility,
          collaboratorUids: patch.collaboratorUids,
          priceCredits: patch.priceCredits,
          universeAddress: patch.universeAddress,
        },
        {
          onSuccess: () => {
            toast.success(`Visibility set to ${patch.visibility}`);
            setPublishOpen(false);
          },
          onError: (err: any) => toast.error(err?.message ?? 'Publish failed'),
        }
      );
    },
    [update, workflowId]
  );

  const onRun = useCallback(() => {
    runMutation.mutate(
      { id: workflowId },
      {
        onSuccess: ({ runId }) => {
          setActiveRunId(runId);
          toast.success(`Run started: ${runId.slice(0, 8)}`);
        },
        onError: (err: any) => toast.error(err?.message ?? 'Run failed'),
      }
    );
  }, [runMutation, workflowId]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  if (isLoading || !workflow) {
    return <div className="p-8 text-sm text-muted-foreground">Loading workflow…</div>;
  }

  // Paid workflow + viewer without a license → show purchase prompt instead of editor.
  if (workflow.visibility === 'paid' && !isOwner && licenseData && !licenseData.hasLicense) {
    return (
      <div className="container mx-auto max-w-xl p-10">
        <div className="rounded-md border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold">{workflow.name}</h1>
          <div className="mt-1 text-sm text-muted-foreground">
            {workflow.description || 'Paid preset — purchase to run.'}
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            <Badge variant="outline">paid</Badge>
            <span>{workflow.priceCredits} credits per run</span>
          </div>
          <Button
            className="mt-4"
            disabled={purchase.isPending}
            onClick={() =>
              purchase.mutate(workflowId, {
                onSuccess: () => toast.success('Purchased — you can now run this workflow'),
                onError: (err: any) => toast.error(err?.message ?? 'Purchase failed'),
              })
            }
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            Buy {workflow.priceCredits} cr
          </Button>
        </div>
      </div>
    );
  }

  // Canon workflow + non-owner: show a read-only summary with a Run button.
  if ((workflow.visibility === 'canon' || workflow.visibility === 'paid') && !isOwner) {
    return (
      <div className="container mx-auto max-w-2xl p-10">
        <div className="rounded-md border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{workflow.name}</h1>
            <Badge variant="outline">
              {workflow.visibility === 'canon' ? (
                <span className="flex items-center gap-1">
                  <Crown className="h-3 w-3" /> canon
                </span>
              ) : (
                'licensed'
              )}
            </Badge>
          </div>
          {workflow.description && (
            <div className="mt-2 text-sm text-muted-foreground">{workflow.description}</div>
          )}
          <div className="mt-3 text-xs text-muted-foreground">
            {workflow.graph.nodes.length} nodes · v{workflow.version} ·
            {cost.data ? ` est ${cost.data.creditsTotal} credits per run` : ''}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button onClick={onRun} disabled={runMutation.isPending}>
              {runMutation.isPending ? 'Starting…' : 'Run'}
            </Button>
            <Button asChild variant="outline">
              <Link to="/workflows/$id/runs" params={{ id: workflowId }}>
                My runs
              </Link>
            </Button>
          </div>
        </div>
        {activeRunId && (
          <div className="mt-4 rounded-md border bg-card shadow-sm">
            <RunPanel
              runId={activeRunId}
              onClose={() => {
                setActiveRunId(null);
                setActiveNodeIds([]);
              }}
              onActiveNodesChange={setActiveNodeIds}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col">
      <header className="flex items-center gap-3 border-b bg-background px-4 py-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={onNameBlur}
          className="h-8 max-w-xs"
        />
        <Badge variant="outline">{workflow.visibility}</Badge>
        <Badge variant="outline">v{workflow.version}</Badge>
        {update.isPending ? (
          <span className="text-xs text-muted-foreground">saving…</span>
        ) : savedAt ? (
          <span className="text-xs text-muted-foreground">
            saved {new Date(savedAt).toLocaleTimeString()}
          </span>
        ) : null}
        {cost.data && (
          <span className="text-xs text-muted-foreground">
            est cost: {cost.data.creditsTotal} credits
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/workflows/$id/runs" params={{ id: workflowId }}>
              Runs
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPublishOpen(true)}>
            Publish
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm('Archive this workflow? You can still see it in the URL.')) {
                archive.mutate(workflowId, {
                  onSuccess: () => toast.success('Archived'),
                });
              }
            }}
          >
            Archive
          </Button>
          <Button size="sm" onClick={onRun} disabled={runMutation.isPending || nodes.length === 0}>
            {runMutation.isPending ? 'Starting…' : 'Run'}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 shrink-0 overflow-y-auto border-r bg-background">
          <NodePalette />
        </aside>

        <main className="flex-1">
          <WorkflowCanvas
            initialNodes={nodes}
            initialEdges={edges}
            onChange={onCanvasChange}
            onSelectionChange={setSelectedNodeId}
            highlightNodeIds={activeNodeIds}
          />
        </main>

        <aside className="w-80 shrink-0 overflow-y-auto border-l bg-background">
          <NodeInspector node={selectedNode} onChange={updateNode} onDelete={deleteNode} />
        </aside>
      </div>

      <RunPanel
        runId={activeRunId}
        onClose={() => {
          setActiveRunId(null);
          setActiveNodeIds([]);
        }}
        onActiveNodesChange={setActiveNodeIds}
      />

      <PublishDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        initialVisibility={workflow.visibility as Visibility}
        initialCollaborators={workflow.collaboratorUids}
        initialPriceCredits={workflow.priceCredits}
        initialUniverseAddress={workflow.universeAddress}
        onSave={onPublish}
        saving={update.isPending}
      />
    </div>
  );
}
