import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Plus, Workflow as WorkflowIcon, GitFork, Archive, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  useArchiveWorkflow,
  useCreateWorkflow,
  useForkWorkflow,
  useWorkflows,
} from '@/hooks/useWorkflows';

export const Route = createFileRoute('/workflows/')({
  component: WorkflowsListPage,
});

function WorkflowsListPage() {
  const { data, isLoading } = useWorkflows();
  const create = useCreateWorkflow();
  const fork = useForkWorkflow();
  const archive = useArchiveWorkflow();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const onCreate = () => {
    create.mutate(
      {
        name: name.trim() || 'Untitled workflow',
        description: '',
        graph: { nodes: [], edges: [] },
      },
      {
        onSuccess: ({ workflow }) => {
          setCreating(false);
          setName('');
          navigate({ to: '/workflows/$id', params: { id: workflow.id } });
        },
        onError: (err: any) => toast.error(err?.message ?? 'Create failed'),
      }
    );
  };

  return (
    <div className="container mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Workflows</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Visual node graphs that chain prompt → animate → upscale into reusable presets.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" /> New workflow
        </Button>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/workflows/marketplace">Browse marketplace →</Link>
        </Button>
      </div>

      <Tabs defaultValue="mine" className="w-full">
        <TabsList>
          <TabsTrigger value="mine">My workflows</TabsTrigger>
          <TabsTrigger value="templates" disabled>
            Templates (Phase 3)
          </TabsTrigger>
        </TabsList>
        <TabsContent value="mine" className="mt-4">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : data?.workflows.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No workflows yet. Click <strong>New workflow</strong> to create one.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data?.workflows.map((w) => (
                <div
                  key={w.id}
                  className="rounded-md border bg-card p-4 transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between">
                    <Link
                      to="/workflows/$id"
                      params={{ id: w.id }}
                      className="flex min-w-0 items-center gap-2 font-semibold hover:underline"
                    >
                      <WorkflowIcon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{w.name}</span>
                    </Link>
                    <Badge variant="outline">{w.visibility}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {w.graph.nodes.length} nodes · v{w.version}
                  </div>
                  {w.description && (
                    <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {w.description}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link to="/workflows/$id" params={{ id: w.id }}>
                        Open <ExternalLink className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        fork.mutate(w.id, {
                          onSuccess: ({ workflow }) => {
                            toast.success('Forked');
                            navigate({ to: '/workflows/$id', params: { id: workflow.id } });
                          },
                        })
                      }
                    >
                      <GitFork className="mr-1 h-3 w-3" /> Fork
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm(`Archive "${w.name}"?`)) {
                          archive.mutate(w.id, { onSuccess: () => toast.success('Archived') });
                        }
                      }}
                    >
                      <Archive className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={creating} onOpenChange={(v) => !v && setCreating(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
          </DialogHeader>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Episode poster pipeline"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCreate();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={onCreate} disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
