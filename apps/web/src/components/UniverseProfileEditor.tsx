/**
 * Universe Profile Editor — owner-only modal for editing the off-chain
 * universe profile (name, description, cover image, portrait/avatar) and
 * flipping the public/private flag.
 *
 * Server-side authorization is enforced by `universes.updateMetadata` and
 * `universes.setPrivate` (creator or current Safe multi-sig signer). This
 * component is just a UI surface — it never assumes its caller is allowed
 * to save; the server will reject unauthorized writes.
 *
 * Privacy toggle is hidden for monetized (launchpad) universes — those are
 * always public from mint, and the server rejects flipping them private.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Eye, EyeOff, ImageIcon, UserCircle2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DirectUpload } from '@/components/DirectUpload';
import { trpcClient } from '@/utils/trpc';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

interface UniverseSnapshot {
  id: string;
  name?: string | null;
  description?: string | null;
  image_url?: string | null;
  portrait_image_url?: string | null;
  isPrivate?: boolean | null;
  universeType?: 'fun' | 'monetized' | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  universe: UniverseSnapshot;
}

export function UniverseProfileEditor({ open, onOpenChange, universe }: Props) {
  const queryClient = useQueryClient();
  const universeId = universe.id;
  const isMonetized = (universe.universeType ?? 'monetized') === 'monetized';

  const [name, setName] = useState(universe.name ?? '');
  const [description, setDescription] = useState(universe.description ?? '');
  const [imageUrl, setImageUrl] = useState(universe.image_url ?? '');
  const [portraitImageUrl, setPortraitImageUrl] = useState(universe.portrait_image_url ?? '');
  const [isPrivate, setIsPrivate] = useState(Boolean(universe.isPrivate));

  // Reset local state every time the dialog opens so stale edits from a
  // previous open are dropped if the user closed without saving.
  useEffect(() => {
    if (!open) return;
    setName(universe.name ?? '');
    setDescription(universe.description ?? '');
    setImageUrl(universe.image_url ?? '');
    setPortraitImageUrl(universe.portrait_image_url ?? '');
    setIsPrivate(Boolean(universe.isPrivate));
  }, [open, universe]);

  const dirty =
    name !== (universe.name ?? '') ||
    description !== (universe.description ?? '') ||
    imageUrl !== (universe.image_url ?? '') ||
    portraitImageUrl !== (universe.portrait_image_url ?? '') ||
    isPrivate !== Boolean(universe.isPrivate);

  const save = useMutation({
    mutationFn: async () => {
      const metadataUpdates: {
        universeId: string;
        name?: string;
        description?: string;
        imageUrl?: string;
        portraitImageUrl?: string | null;
      } = { universeId };

      if (name.trim() && name !== (universe.name ?? '')) {
        metadataUpdates.name = name.trim();
      }
      if (description.trim() && description !== (universe.description ?? '')) {
        metadataUpdates.description = description.trim();
      }
      if (imageUrl && imageUrl !== (universe.image_url ?? '')) {
        metadataUpdates.imageUrl = imageUrl;
      }
      if (portraitImageUrl !== (universe.portrait_image_url ?? '')) {
        metadataUpdates.portraitImageUrl = portraitImageUrl ? portraitImageUrl : null;
      }

      // Only call updateMetadata when there is at least one metadata field
      // to change — avoids a no-op write that still bumps `updated_at`.
      const hasMetadataChange =
        metadataUpdates.name !== undefined ||
        metadataUpdates.description !== undefined ||
        metadataUpdates.imageUrl !== undefined ||
        metadataUpdates.portraitImageUrl !== undefined;

      if (hasMetadataChange) {
        await trpcClient.universes.updateMetadata.mutate(metadataUpdates);
      }

      if (!isMonetized && isPrivate !== Boolean(universe.isPrivate)) {
        await trpcClient.universes.setPrivate.mutate({ universeId, isPrivate });
      }
    },
    onSuccess: () => {
      toast.success('Profile updated');
      queryClient.invalidateQueries({ queryKey: ['universe'] });
      queryClient.invalidateQueries({ queryKey: ['universes'] });
      queryClient.invalidateQueries({ queryKey: ['universe-metadata', universeId] });
      queryClient.invalidateQueries({ queryKey: ['universe-privacy', universeId] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit universe profile</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Cover image */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5" /> Cover image
            </Label>
            {imageUrl && (
              <div className="relative aspect-[16/9] w-full overflow-hidden rounded-md border border-white/10 bg-muted">
                <img
                  src={resolveIpfsUrl(imageUrl)}
                  alt="Cover preview"
                  className="h-full w-full object-cover"
                />
              </div>
            )}
            <DirectUpload
              acceptedTypes={['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']}
              maxSizeMB={20}
              label="Replace cover (16:9 recommended)"
              onUploadComplete={(manifest) => {
                const url = manifest.uploads[0]?.url;
                if (url) setImageUrl(url);
              }}
            />
          </div>

          {/* Portrait / avatar */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <UserCircle2 className="h-3.5 w-3.5" /> Profile portrait
            </Label>
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-full border border-white/10 bg-muted">
                {portraitImageUrl ? (
                  <img
                    src={resolveIpfsUrl(portraitImageUrl)}
                    alt="Portrait preview"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    none
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <DirectUpload
                  acceptedTypes={['image/jpeg', 'image/png', 'image/webp', 'image/avif']}
                  maxSizeMB={10}
                  label="Replace portrait (1:1 square)"
                  onUploadComplete={(manifest) => {
                    const url = manifest.uploads[0]?.url;
                    if (url) setPortraitImageUrl(url);
                  }}
                />
                {portraitImageUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPortraitImageUrl('')}
                    className="text-xs text-muted-foreground"
                  >
                    Remove portrait
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="universe-name">Name</Label>
            <Input
              id="universe-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="My universe"
            />
            <p className="text-xs text-muted-foreground text-right">{name.length}/200</p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="universe-description">Description</Label>
            <Textarea
              id="universe-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              rows={5}
              placeholder="What's this universe about? Setting, vibe, tone…"
            />
            <p className="text-xs text-muted-foreground text-right">{description.length}/1000</p>
          </div>

          {/* Visibility */}
          <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-1.5">
                  {isPrivate ? (
                    <EyeOff className="h-4 w-4 text-amber-400" />
                  ) : (
                    <Eye className="h-4 w-4 text-emerald-400" />
                  )}
                  {isPrivate ? 'Private' : 'Public'}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {isMonetized
                    ? 'Launchpad universes are always public — the on-chain token is tradable.'
                    : isPrivate
                      ? 'Hidden from public listings. Only you can see this universe.'
                      : 'Listed everywhere. Anyone can find and watch.'}
                </p>
              </div>
              <Button
                type="button"
                variant={isPrivate ? 'outline' : 'default'}
                size="sm"
                disabled={isMonetized}
                onClick={() => setIsPrivate((v) => !v)}
              >
                {isPrivate ? 'Make public' : 'Make private'}
              </Button>
            </div>
            {isMonetized && (
              <Badge variant="outline" className="text-[10px]">
                Launchpad — visibility locked public
              </Badge>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending || !name.trim() || !description.trim()}
          >
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
