/**
 * Universe Physics editor.
 *
 * Creators author the invariants, conservation rules, and forbidden events
 * their universe is bound by. The validator (physics.validate) uses these
 * rules to surface contradictions in canon content before it lands.
 *
 * Route: /universe/$address/physics
 * Read-only for non-creators; edit for the universe creator.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { trpcClient, queryClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Loader2,
  Plus,
  Save,
  Scale,
  ShieldAlert,
  Trash2,
  Atom,
  Play,
} from 'lucide-react';

type Severity = 'must' | 'should';

interface Invariant {
  id: string;
  name: string;
  rule: string;
  severity: Severity;
}

interface ConservationRule {
  id: string;
  name: string;
  description: string;
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function PhysicsPage() {
  const { address } = Route.useParams() as { address: string };
  const { address: walletAddress, isAuthenticated } = useWalletAuth();

  const lawsQuery = useQuery({
    queryKey: ['physics', 'get', address],
    queryFn: () => trpcClient.physics.get.query({ universeAddress: address }),
  });

  const universeQuery = useQuery({
    queryKey: ['universe', address],
    queryFn: () => trpcClient.universes.get.query({ id: address }),
  });

  const universeInfo = universeQuery.data?.data as
    | { id: string; name?: string; creator?: string }
    | undefined;
  const isCreator =
    isAuthenticated &&
    walletAddress &&
    universeInfo?.creator?.toLowerCase() === walletAddress.toLowerCase();

  const [invariants, setInvariants] = useState<Invariant[]>([]);
  const [conservation, setConservation] = useState<ConservationRule[]>([]);
  const [forbidden, setForbidden] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [validateText, setValidateText] = useState('');

  // Hydrate local state once when the laws load. Creator edits set `dirty`
  // which locks the hydration so query refetches don't clobber unsaved work.
  useEffect(() => {
    const laws = lawsQuery.data?.laws;
    if (laws && !dirty) {
      setInvariants(laws.invariants ?? []);
      setConservation(laws.conservationRules ?? []);
      setForbidden(laws.forbiddenEvents ?? []);
    }
  }, [lawsQuery.data, dirty]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      trpcClient.physics.set.mutate({
        universeAddress: address,
        invariants,
        conservationRules: conservation,
        forbiddenEvents: forbidden.map((f) => f.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      toast.success('Physics saved');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['physics', 'get', address] });
    },
    onError: (err: any) => toast.error(err.message ?? 'Save failed'),
  });

  const validateQuery = useQuery({
    queryKey: ['physics', 'validate', address, validateText],
    queryFn: () =>
      trpcClient.physics.validate.query({
        universeAddress: address,
        content: validateText,
      }),
    enabled: false,
  });

  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl">
      <Link to="/universe/$id" params={{ id: address }}>
        <Button variant="outline" className="mb-6">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Universe
        </Button>
      </Link>

      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Atom className="w-6 h-6 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">Physics</h1>
        </div>
        <p className="text-muted-foreground max-w-2xl">
          Declare the laws, invariants, and forbidden events of{' '}
          <span className="text-foreground font-semibold">{universeInfo?.name ?? address}</span>.
          These rules are what your universe conserves — they become guardrails for canon publishing
          and a reference for anyone building in this world.
        </p>
      </div>

      {lawsQuery.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Invariants */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-400" />
                <CardTitle className="text-base">Invariants</CardTitle>
              </div>
              {isCreator && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setInvariants((prev) => [
                      ...prev,
                      { id: newId(), name: '', rule: '', severity: 'must' },
                    ]);
                    setDirty(true);
                  }}
                >
                  <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Statements that must remain true across all canon content.{' '}
                <span className="text-amber-400">must</span> blocks publishes that violate it;{' '}
                <span className="text-muted-foreground">should</span> only warns.
              </p>
              {invariants.length === 0 && (
                <p className="text-sm text-muted-foreground italic">No invariants declared yet.</p>
              )}
              {invariants.map((inv, idx) => (
                <div key={inv.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Name (e.g. 'Death is permanent')"
                      value={inv.name}
                      onChange={(e) => {
                        const next = [...invariants];
                        next[idx] = { ...inv, name: e.target.value };
                        setInvariants(next);
                        setDirty(true);
                      }}
                      disabled={!isCreator}
                    />
                    <Select
                      value={inv.severity}
                      onValueChange={(v) => {
                        const next = [...invariants];
                        next[idx] = { ...inv, severity: v as Severity };
                        setInvariants(next);
                        setDirty(true);
                      }}
                      disabled={!isCreator}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="must">must</SelectItem>
                        <SelectItem value="should">should</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    placeholder="Rule — natural language. 'Characters who die in canon do not come back without a stated cost.'"
                    value={inv.rule}
                    rows={3}
                    onChange={(e) => {
                      const next = [...invariants];
                      next[idx] = { ...inv, rule: e.target.value };
                      setInvariants(next);
                      setDirty(true);
                    }}
                    disabled={!isCreator}
                  />
                  {isCreator && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        setInvariants((prev) => prev.filter((_, i) => i !== idx));
                        setDirty(true);
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-1" /> Remove
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Conservation rules */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Scale className="w-5 h-5 text-cyan-400" />
                <CardTitle className="text-base">Conservation Rules</CardTitle>
              </div>
              {isCreator && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setConservation((prev) => [
                      ...prev,
                      { id: newId(), name: '', description: '' },
                    ]);
                    setDirty(true);
                  }}
                >
                  <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                What is preserved — energy, memory, debt, karma, identity. The cost side of every
                action.
              </p>
              {conservation.length === 0 && (
                <p className="text-sm text-muted-foreground italic">
                  No conservation rules declared yet.
                </p>
              )}
              {conservation.map((rule, idx) => (
                <div key={rule.id} className="rounded-lg border p-4 space-y-3">
                  <Input
                    placeholder="Name (e.g. 'Magic requires a price')"
                    value={rule.name}
                    onChange={(e) => {
                      const next = [...conservation];
                      next[idx] = { ...rule, name: e.target.value };
                      setConservation(next);
                      setDirty(true);
                    }}
                    disabled={!isCreator}
                  />
                  <Textarea
                    placeholder="Describe what this conserves and what pays the cost."
                    value={rule.description}
                    rows={2}
                    onChange={(e) => {
                      const next = [...conservation];
                      next[idx] = { ...rule, description: e.target.value };
                      setConservation(next);
                      setDirty(true);
                    }}
                    disabled={!isCreator}
                  />
                  {isCreator && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        setConservation((prev) => prev.filter((_, i) => i !== idx));
                        setDirty(true);
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-1" /> Remove
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Forbidden events */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Forbidden Events</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Phrases that never happen in this universe. Case-insensitive substring match — keep
                them concise.
              </p>
              {forbidden.map((phrase, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input
                    placeholder="e.g. 'resurrection', 'time travel'"
                    value={phrase}
                    onChange={(e) => {
                      const next = [...forbidden];
                      next[idx] = e.target.value;
                      setForbidden(next);
                      setDirty(true);
                    }}
                    disabled={!isCreator}
                  />
                  {isCreator && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        setForbidden((prev) => prev.filter((_, i) => i !== idx));
                        setDirty(true);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
              {isCreator && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setForbidden((prev) => [...prev, '']);
                    setDirty(true);
                  }}
                >
                  <Plus className="w-4 h-4 mr-1" /> Add phrase
                </Button>
              )}
            </CardContent>
          </Card>

          {isCreator && (
            <div className="flex items-center gap-3">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!dirty || saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Save Physics
              </Button>
              {dirty && <span className="text-sm text-amber-400">Unsaved changes</span>}
            </div>
          )}

          {/* Live validator */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Validate Content</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Paste a plot summary, an episode description, or a canon proposal. The validator
                will surface any rules this content might violate.
              </p>
              <Textarea
                value={validateText}
                onChange={(e) => setValidateText(e.target.value)}
                placeholder="Paste content to validate against this universe's physics..."
                rows={5}
              />
              <Button
                onClick={() => validateQuery.refetch()}
                disabled={!validateText.trim() || validateQuery.isFetching}
              >
                {validateQuery.isFetching ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Run Validator
              </Button>

              {validateQuery.data && (
                <div className="mt-4 space-y-2">
                  {validateQuery.data.violations.length === 0 ? (
                    <p className="text-sm text-emerald-400">
                      No violations detected against {validateQuery.data.laws.invariants.length}{' '}
                      invariant(s) and {validateQuery.data.laws.forbiddenEvents.length} forbidden
                      event(s).
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <Badge
                          className={
                            validateQuery.data.hasBlocking
                              ? 'bg-red-500/10 text-red-400 border-red-500/30'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          }
                        >
                          {validateQuery.data.hasBlocking ? 'Blocking violations' : 'Advisory only'}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {validateQuery.data.violations.length} match
                          {validateQuery.data.violations.length === 1 ? '' : 'es'}
                        </span>
                      </div>
                      {validateQuery.data.violations.map((v, i) => (
                        <div
                          key={`${v.ref}-${i}`}
                          className={`rounded-lg border p-3 text-sm ${
                            v.severity === 'must'
                              ? 'border-red-500/30 bg-red-500/5'
                              : 'border-amber-500/30 bg-amber-500/5'
                          }`}
                        >
                          <div className="font-medium mb-1">
                            <Badge variant="outline" className="mr-2 text-[10px] uppercase">
                              {v.kind === 'forbidden_event' ? 'forbidden' : v.severity}
                            </Badge>
                            {v.name}
                          </div>
                          {v.excerpt && (
                            <p className="text-xs text-muted-foreground italic">"…{v.excerpt}…"</p>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/universe/$address/physics')({
  component: PhysicsPage,
});
