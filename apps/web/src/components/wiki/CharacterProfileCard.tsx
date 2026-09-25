/**
 * Character dossier for `person` wiki entities.
 *
 * Renders the server-built profile (entities.characterProfile): completeness,
 * grouped fields, and an asset checklist. Owners can fill any empty field
 * inline or have the AI complete everything still missing; nothing written by
 * a human is ever overwritten.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Circle, Loader2, Pencil, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { UserText } from '@/components/user-text';
import { trpcClient } from '@/utils/trpc';
import { requireProviderKey } from '@/lib/apiKeyGate';

interface Props {
  entityId: string;
  /** Current raw metadata — merged into on save, since entities.update replaces it wholesale. */
  metadata: Record<string, unknown>;
  isOwner: boolean;
  /** Fired after any successful write so the parent can refetch the entity. */
  onChanged?: () => void;
}

const profileKey = (entityId: string) => ['character-profile', entityId] as const;

export function CharacterProfileCard({ entityId, metadata, isOwner, onChanged }: Props) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);

  const { data: profile } = useQuery({
    queryKey: profileKey(entityId),
    queryFn: () => trpcClient.entities.characterProfile.query({ entityId }),
  });

  if (!profile) return null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: profileKey(entityId) });
    queryClient.invalidateQueries({ queryKey: ['entity', entityId] });
    onChanged?.();
  };

  const startEdit = (key: string, value: string) => {
    setEditing(key);
    setDraft(value);
  };

  const save = async (key: string) => {
    setSaving(true);
    try {
      await trpcClient.entities.update.mutate({
        entityId,
        metadata: { ...metadata, [key]: draft.trim() },
      });
      setEditing(null);
      refresh();
    } catch (err: any) {
      toast.error(err.message ?? 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const complete = async () => {
    setCompleting(true);
    try {
      const res = await trpcClient.entities.completeCharacterProfile.mutate({ entityId });
      if (res.added.length === 0) toast.info('Nothing new was generated');
      else toast.success(`Filled in ${res.added.length} field${res.added.length === 1 ? '' : 's'}`);
      refresh();
    } catch (err: any) {
      // Profile generation uses the caller's own Google key — offer the "add your key" modal.
      const provider = err?.data?.byokRequired ? err.data.provider : undefined;
      if (provider) {
        const saved = await requireProviderKey(provider, { reason: err.message });
        if (saved) {
          setCompleting(false);
          return complete();
        }
      } else {
        toast.error(err.message ?? 'AI completion failed');
      }
    } finally {
      setCompleting(false);
    }
  };

  const { completeness, sections, extra, assets, appearances } = profile;
  const canComplete = isOwner && completeness.missing.length > 0;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">Character Profile</CardTitle>
          {canComplete && (
            <Button variant="outline" size="sm" onClick={complete} disabled={completing}>
              {completing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              {completing ? 'Filling in…' : `Complete with AI (${completeness.missing.length})`}
            </Button>
          )}
        </div>
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>
              {completeness.filled} of {completeness.total} fields
            </span>
            <span>{completeness.percent}%</span>
          </div>
          <div
            className="h-1.5 rounded-full bg-muted overflow-hidden"
            role="progressbar"
            aria-valuenow={completeness.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Profile completeness"
          >
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${completeness.percent}%` }}
            />
          </div>
        </div>
        <ul className="flex flex-wrap gap-2">
          {assets.map((a) => (
            <li
              key={a.key}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                a.done ? 'text-foreground' : 'text-muted-foreground/70'
              }`}
            >
              {a.done ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Circle className="w-3 h-3" />
              )}
              {a.label}
              {a.done && a.count && a.count > 1 ? ` · ${a.count}` : ''}
            </li>
          ))}
        </ul>
      </CardHeader>

      <CardContent className="space-y-6">
        {sections.map((section) => {
          const visible = isOwner ? section.fields : section.fields.filter((f) => f.filled);
          if (visible.length === 0) return null;
          return (
            <section key={section.id} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </h3>
              {visible.map((f) => (
                <div key={f.key}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <dt className="text-xs font-medium text-muted-foreground">{f.label}</dt>
                    {isOwner && editing !== f.key && f.filled && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Edit ${f.label}`}
                        onClick={() => startEdit(f.key, f.value)}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {editing === f.key ? (
                    <div className="space-y-2">
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={f.hint}
                        rows={f.long ? 4 : 2}
                        maxLength={1200}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => save(f.key)} disabled={saving}>
                          {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(null)}
                          disabled={saving}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : f.filled ? (
                    <dd className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                      <UserText>{f.value}</UserText>
                    </dd>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-sm text-muted-foreground/70 hover:text-foreground"
                      onClick={() => startEdit(f.key, '')}
                    >
                      <Plus className="w-3 h-3" /> Add {f.label.toLowerCase()}
                    </button>
                  )}
                </div>
              ))}
            </section>
          );
        })}

        {appearances.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Appears in ({appearances.length})
            </h3>
            <ul className="space-y-2">
              {appearances.map((a) => (
                <li key={a.id}>
                  <Link
                    to="/episode/$id"
                    params={{ id: a.id }}
                    className="block rounded-md p-2 -mx-2 hover:bg-muted/50 transition-colors"
                  >
                    <span className="text-sm font-medium block">{a.title}</span>
                    {a.snippet && (
                      <span className="text-xs text-muted-foreground line-clamp-2">
                        {a.snippet}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {extra.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Other details
            </h3>
            {extra.map((e) => (
              <div key={e.key}>
                <dt className="text-xs font-medium text-muted-foreground mb-1">{e.key}</dt>
                <dd className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                  <UserText>{e.value}</UserText>
                </dd>
              </div>
            ))}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
