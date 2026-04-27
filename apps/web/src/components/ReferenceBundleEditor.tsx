/**
 * Reference Bundle Editor — Character Identity Lock + Multi-Reference Editing.
 *
 * Lets the owner of an entity attach reference images to five slots
 * (character / outfit / prop / environment / style), toggle four identity
 * locks (face, costume, colors, silhouette), and dial identity strength.
 *
 * Refs can be pasted as URLs (from anywhere on LOAR) or uploaded directly
 * through DirectUpload, which lands files in Pinata/Lighthouse via the
 * StorageManager.
 *
 * Inherited slots (walked from the entity's parent chain) render as a
 * secondary chip so the user sees what is already on-model via hierarchy.
 */
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Fingerprint, Layers, Plus, Trash2, Sparkles, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { DirectUpload } from './DirectUpload';
import {
  REFERENCE_SLOTS,
  REFERENCE_SLOT_LABELS,
  IDENTITY_LOCKS,
  IDENTITY_LOCK_LABELS,
  MAX_REFS_PER_SLOT,
  type ReferenceSlot,
  type IdentityLock,
  type ResolvedReferenceBundle,
  useReferenceBundle,
  useSetReferenceBundle,
  useClearReferenceBundle,
} from '@/hooks/useReferenceBundle';

interface Props {
  entityId: string;
  isOwner: boolean;
}

type SlotState = Partial<Record<ReferenceSlot, string[]>>;
type LocksState = Partial<Record<IdentityLock, boolean>>;

/** Narrow a bundle to only the values directly set on this entity (not inherited). */
function extractDirectSlots(bundle: ResolvedReferenceBundle | null): SlotState {
  if (!bundle) return {};
  const direct: SlotState = {};
  for (const slot of bundle.directSlots) {
    if (bundle.slots[slot]) direct[slot] = [...(bundle.slots[slot] ?? [])];
  }
  return direct;
}

export function ReferenceBundleEditor({ entityId, isOwner }: Props) {
  const { data, isLoading } = useReferenceBundle(entityId, true);
  const setMutation = useSetReferenceBundle(entityId);
  const clearMutation = useClearReferenceBundle(entityId);

  const bundle = data?.bundle ?? null;

  const [slots, setSlots] = useState<SlotState>({});
  const [locks, setLocks] = useState<LocksState>({});
  const [identityStrength, setIdentityStrength] = useState<number>(0.7);
  const [activeSlot, setActiveSlot] = useState<ReferenceSlot>('character');
  const [urlDraft, setUrlDraft] = useState('');
  const [showUploader, setShowUploader] = useState(false);

  // Seed local state from the resolved bundle. Only direct slots are
  // editable — inherited slots display underneath as read-only context.
  useEffect(() => {
    setSlots(extractDirectSlots(bundle));
    setLocks(bundle?.locks ? { ...bundle.locks } : {});
    setIdentityStrength(bundle?.identityStrength ?? 0.7);
  }, [bundle?.updatedAt, entityId]);

  const dirCount = useMemo(
    () =>
      (Object.keys(slots) as ReferenceSlot[]).reduce(
        (acc, slot) => acc + (slots[slot]?.length ?? 0),
        0
      ),
    [slots]
  );

  const activeLocks = useMemo(() => IDENTITY_LOCKS.filter((k) => locks[k] === true), [locks]);

  const canAddToActiveSlot = (slots[activeSlot]?.length ?? 0) < MAX_REFS_PER_SLOT;

  const addUrlToActiveSlot = (url: string) => {
    if (!url) return;
    const trimmed = url.trim();
    try {
      // Basic URL validation — matches server-side z.string().url()
      new URL(trimmed);
    } catch {
      toast.error('That doesn’t look like a valid URL');
      return;
    }
    setSlots((prev) => {
      const existing = prev[activeSlot] ?? [];
      if (existing.includes(trimmed)) return prev;
      if (existing.length >= MAX_REFS_PER_SLOT) {
        toast.error(`Max ${MAX_REFS_PER_SLOT} references per slot`);
        return prev;
      }
      return { ...prev, [activeSlot]: [...existing, trimmed] };
    });
    setUrlDraft('');
  };

  const removeUrlFromSlot = (slot: ReferenceSlot, url: string) => {
    setSlots((prev) => {
      const existing = prev[slot] ?? [];
      const next = existing.filter((u) => u !== url);
      const copy = { ...prev };
      if (next.length === 0) delete copy[slot];
      else copy[slot] = next;
      return copy;
    });
  };

  const handleSave = async () => {
    try {
      await setMutation.mutateAsync({ slots, locks, identityStrength });
      toast.success('Reference bundle saved');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save bundle');
    }
  };

  const handleClear = async () => {
    try {
      await clearMutation.mutateAsync();
      toast.success('Reference bundle cleared');
      setSlots({});
      setLocks({});
      setIdentityStrength(0.7);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to clear bundle');
    }
  };

  // Read-only view for non-owners when something resolvable exists.
  if (!isOwner) {
    if (!bundle || (Object.keys(bundle.slots).length === 0 && activeLocks.length === 0)) {
      return null;
    }
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Fingerprint className="w-4 h-4" />
            Identity References
            <Badge variant="secondary" className="text-[10px]">
              {Object.values(bundle.slots).reduce((a, b) => a + (b?.length ?? 0), 0)} refs
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {REFERENCE_SLOTS.map((slot) => {
            const urls = bundle.slots[slot] ?? [];
            if (urls.length === 0) return null;
            const inherited = bundle.inheritedFrom[slot];
            return (
              <div key={slot}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-medium">{REFERENCE_SLOT_LABELS[slot]}</span>
                  {inherited && (
                    <Badge variant="outline" className="text-[9px]">
                      inherited from {inherited.entityName}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {urls.map((u) => (
                    <img
                      key={u}
                      src={u}
                      alt={slot}
                      className="h-16 w-16 object-cover rounded border"
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {bundle.locks && Object.keys(bundle.locks).length > 0 && (
            <div>
              <Separator className="my-2" />
              <div className="flex flex-wrap gap-1.5">
                {IDENTITY_LOCKS.filter((k) => bundle.locks?.[k]).map((k) => (
                  <Badge key={k} variant="secondary" className="text-[10px]">
                    {IDENTITY_LOCK_LABELS[k]}
                  </Badge>
                ))}
                <Badge variant="outline" className="text-[10px]">
                  strength {Math.round((bundle.identityStrength ?? 0.7) * 100)}%
                </Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Loading reference bundle…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Fingerprint className="w-4 h-4" />
            Identity Lock &amp; References
            {dirCount > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {dirCount} {dirCount === 1 ? 'ref' : 'refs'}
              </Badge>
            )}
            {activeLocks.length > 0 && (
              <Badge className="text-[10px] bg-primary/90">
                {activeLocks.length} lock{activeLocks.length === 1 ? '' : 's'}
              </Badge>
            )}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Drop reference images into a slot so generations stay on-model. Children of this entity
          inherit these refs automatically.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Slot tabs */}
        <div className="flex flex-wrap gap-1.5">
          {REFERENCE_SLOTS.map((slot) => {
            const count = slots[slot]?.length ?? 0;
            const inherited = bundle?.inheritedFrom[slot];
            const isActive = activeSlot === slot;
            return (
              <button
                key={slot}
                type="button"
                onClick={() => {
                  setActiveSlot(slot);
                  setShowUploader(false);
                }}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background hover:bg-muted border-border'
                }`}
              >
                {REFERENCE_SLOT_LABELS[slot]}
                {count > 0 && (
                  <span className="ml-1.5 opacity-75">
                    {count}/{MAX_REFS_PER_SLOT}
                  </span>
                )}
                {inherited && count === 0 && (
                  <Layers className="inline-block ml-1.5 w-3 h-3 opacity-60" />
                )}
              </button>
            );
          })}
        </div>

        {/* Active slot images */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs">{REFERENCE_SLOT_LABELS[activeSlot]} references</Label>
            {bundle?.inheritedFrom[activeSlot] && (slots[activeSlot]?.length ?? 0) === 0 && (
              <span className="text-[11px] text-muted-foreground">
                inherited from {bundle.inheritedFrom[activeSlot]!.entityName}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            {(slots[activeSlot] ?? []).map((url) => (
              <div key={url} className="relative group">
                <img
                  src={url}
                  alt="ref"
                  loading="lazy"
                  decoding="async"
                  className="h-20 w-20 object-cover rounded border"
                />
                <button
                  type="button"
                  onClick={() => removeUrlFromSlot(activeSlot, url)}
                  className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Remove reference"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}

            {/* Inherited preview row when this slot has no direct refs */}
            {(slots[activeSlot]?.length ?? 0) === 0 &&
              (bundle?.slots[activeSlot]?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-2 opacity-70">
                  {(bundle!.slots[activeSlot] ?? []).map((url) => (
                    <img
                      key={url}
                      src={url}
                      alt="inherited ref"
                      className="h-20 w-20 object-cover rounded border border-dashed"
                      title="Inherited"
                    />
                  ))}
                </div>
              )}

            {(slots[activeSlot]?.length ?? 0) === 0 &&
              (bundle?.slots[activeSlot]?.length ?? 0) === 0 && (
                <div className="text-xs text-muted-foreground py-3">
                  No references in this slot yet.
                </div>
              )}
          </div>

          {/* Add via URL */}
          <div className="flex gap-2 mb-2">
            <Input
              placeholder="Paste image URL (ipfs://, https://…)"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              disabled={!canAddToActiveSlot}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addUrlToActiveSlot(urlDraft);
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => addUrlToActiveSlot(urlDraft)}
              disabled={!canAddToActiveSlot || !urlDraft.trim()}
            >
              <Plus className="w-3 h-3 mr-1" />
              Add
            </Button>
          </div>

          {/* Upload */}
          {canAddToActiveSlot && !showUploader && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowUploader(true)}
              className="text-xs"
            >
              <Sparkles className="w-3 h-3 mr-1" />
              or upload a file
            </Button>
          )}
          {showUploader && canAddToActiveSlot && (
            <div className="mt-2">
              <DirectUpload
                acceptedTypes={[
                  'image/jpeg',
                  'image/png',
                  'image/webp',
                  'image/avif',
                  'image/heic',
                ]}
                maxSizeMB={25}
                label={`Upload a ${REFERENCE_SLOT_LABELS[activeSlot].toLowerCase()} reference`}
                onUploadComplete={(manifest) => {
                  const url = manifest.uploads[0]?.url;
                  if (url) {
                    addUrlToActiveSlot(url);
                    setShowUploader(false);
                  }
                }}
              />
            </div>
          )}
        </div>

        <Separator />

        {/* Identity locks */}
        <div>
          <Label className="text-xs mb-2 block">Lock toggles</Label>
          <div className="grid grid-cols-2 gap-2">
            {IDENTITY_LOCKS.map((lock) => (
              <label
                key={lock}
                className="flex items-center gap-2 text-sm cursor-pointer select-none"
              >
                <Checkbox
                  checked={locks[lock] === true}
                  onCheckedChange={(checked) =>
                    setLocks((prev) => ({ ...prev, [lock]: checked === true }))
                  }
                />
                <span>{IDENTITY_LOCK_LABELS[lock]}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Identity strength */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs">Identity strength</Label>
            <span className="text-xs font-mono">{Math.round(identityStrength * 100)}%</span>
          </div>
          <Slider
            min={0}
            max={100}
            step={5}
            value={[Math.round(identityStrength * 100)]}
            onValueChange={(v) => setIdentityStrength((v[0] ?? 70) / 100)}
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Higher values hold closer to the references — lower values allow the generator more
            creative latitude.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={clearMutation.isPending || (!bundle && dirCount === 0)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Clear bundle
          </Button>
          <Button size="sm" onClick={handleSave} disabled={setMutation.isPending}>
            {setMutation.isPending ? 'Saving…' : 'Save bundle'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
