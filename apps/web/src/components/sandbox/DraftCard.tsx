import React, { useState } from 'react';
import {
  Wand2,
  Video,
  Trash2,
  Check,
  ExternalLink,
  ImageIcon,
  Download,
  Box,
  Plus,
  RefreshCw,
  AudioLines,
  Music,
  Mic,
  Pencil,
  Share,
  ArrowRight,
  Expand,
  Maximize2,
  Sparkles,
  Sun,
  Eraser,
  Frame,
  Loader2,
  Rocket,
  Globe,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';
import { resolveIpfsUrl } from '@/utils/ipfs-url';
import type { DraftData, GenKind } from '@/types/sandbox.types';

// ── Draft Card ─────────────────────────────────────────────────

interface DraftCardProps {
  draft: DraftData;
  onDelete: () => void;
  onReuse: () => void;
}

export function inferDraftKind(draft: DraftData): GenKind {
  if (draft.kind === '3d' || draft.kind === '3d-model' || draft.modelUrl) return '3d-model';
  if (draft.kind === 'audio' || draft.audioUrl) return 'audio';
  if (draft.kind === 'video' || draft.videoUrl) return 'video';
  return 'image';
}

export function DraftCard({ draft, onDelete, onReuse }: DraftCardProps) {
  const queryClient = useQueryClient();
  const draftKind = inferDraftKind(draft);
  const isPromoted = draft.status === 'promoted';

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(draft.title);

  const [showPromote, setShowPromote] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState('__gallery__');
  // Defaults match the safer auto-publish defaults the server uses (fan +
  // unlisted) so users explicitly opt into a rights claim before promoting.
  const [classification, setClassification] = useState<'fan' | 'original' | 'licensed'>('fan');
  const [visibility, setVisibility] = useState<'public' | 'private' | 'unlisted'>('public');

  const { data: universesResult } = useQuery({
    queryKey: ['all-universes'],
    queryFn: () => trpcClient.universes.getAll.query(),
    enabled: showPromote,
  });
  const universes = (universesResult as any)?.data ?? universesResult ?? [];

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; title?: string; tags?: string[] }) =>
      trpcClient.sandbox.updateDraft.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandbox-drafts'] });
      setEditing(false);
      toast.success('Draft updated');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update'),
  });

  const promoteMutation = useMutation({
    mutationFn: () =>
      trpcClient.sandbox.promoteToUniverse.mutate({
        draftId: draft.id,
        ...(selectedTarget !== '__gallery__' ? { universeId: selectedTarget } : {}),
        classification,
        visibility,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandbox-drafts'] });
      setShowPromote(false);
      toast.success(
        selectedTarget === '__gallery__' ? 'Published to your gallery!' : 'Promoted to universe!'
      );
    },
    onError: (err: any) => toast.error(err.message || 'Failed to promote'),
  });

  return (
    <Card className="overflow-hidden group relative">
      {/* Thumbnail */}
      <div className="aspect-video bg-muted relative">
        {draftKind === 'audio' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-primary/20 to-primary/5 px-3">
            <Sparkles className="h-6 w-6 text-primary" />
            {draft.audioUrl ? (
              <audio src={draft.audioUrl} controls className="w-full" />
            ) : (
              <span className="text-[10px] text-muted-foreground">Audio draft</span>
            )}
          </div>
        ) : draftKind === '3d-model' ? (
          draft.thumbnailUrl || draft.imageUrl ? (
            <img
              src={resolveIpfsUrl((draft.thumbnailUrl || draft.imageUrl)!)}
              alt={draft.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
              <Frame className="h-6 w-6 text-muted-foreground/40" />
              <span className="text-[10px] text-muted-foreground">3D model</span>
            </div>
          )
        ) : draft.videoUrl ? (
          <video
            src={resolveIpfsUrl(draft.videoUrl)}
            className="w-full h-full object-cover"
            muted
            playsInline
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLVideoElement).play().catch(() => {});
            }}
            onMouseLeave={(e) => {
              const v = e.currentTarget as HTMLVideoElement;
              v.pause();
              v.currentTime = 0;
            }}
          />
        ) : draft.imageUrl ? (
          <img
            src={resolveIpfsUrl(draft.imageUrl)}
            alt={draft.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Wand2 className="h-6 w-6 text-muted-foreground/30" />
          </div>
        )}

        <div className="absolute top-2 left-2 flex gap-1">
          {isPromoted && (
            <Badge className="bg-green-500/90 text-white border-0 text-[10px]">Promoted</Badge>
          )}
          <Badge variant="secondary" className="text-[9px] capitalize">
            {draftKind === '3d-model' ? '3D' : draftKind}
          </Badge>
        </div>

        {!showPromote && (
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            {!isPromoted && (
              <Button size="sm" variant="default" onClick={() => setShowPromote(true)}>
                <Rocket className="h-3.5 w-3.5 mr-1" />
                Promote
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={onReuse}>
              Reuse
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <CardContent className="p-3">
        {editing ? (
          <div className="flex items-center gap-1">
            <Input
              value={editTitle}
              onChange={(e: any) => setEditTitle(e.target.value)}
              className="h-7 text-sm px-2"
              autoFocus
              onKeyDown={(e: any) => {
                if (e.key === 'Enter') {
                  updateMutation.mutate({ id: draft.id, title: editTitle });
                }
                if (e.key === 'Escape') {
                  setEditing(false);
                  setEditTitle(draft.title);
                }
              }}
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => updateMutation.mutate({ id: draft.id, title: editTitle })}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                setEditing(false);
                setEditTitle(draft.title);
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <p className="text-sm font-medium truncate">{draft.title}</p>
        )}
        <p className="text-xs text-muted-foreground truncate mt-0.5">{draft.prompt}</p>
        <div className="flex items-center gap-1.5 mt-1.5">
          {draft.videoUrl && (
            <Badge variant="secondary" className="text-xs">
              <Video className="h-2.5 w-2.5 mr-1" />
              Video
            </Badge>
          )}
          {draft.model && (
            <Badge variant="outline" className="text-[10px]">
              {draft.model.replace('fal-', '')}
            </Badge>
          )}
        </div>

        {showPromote && !isPromoted && (
          <div className="mt-3 pt-3 border-t space-y-2">
            <p className="text-xs font-semibold flex items-center gap-1.5">
              <Globe className="h-3 w-3" />
              Promote to Universe
            </p>

            <Select value={selectedTarget} onValueChange={setSelectedTarget}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select destination" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__gallery__" className="text-xs font-medium">
                  My Gallery (no universe)
                </SelectItem>
                {Array.isArray(universes) &&
                  universes.map((u: any) => (
                    <SelectItem key={u.id} value={u.id} className="text-xs">
                      {u.name || u.id.slice(0, 12)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            <div className="flex gap-1">
              {(['original', 'fan', 'licensed'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setClassification(c)}
                  className={`flex-1 text-[10px] py-1 rounded-md border transition-colors ${
                    classification === c
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                  }`}
                >
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </button>
              ))}
            </div>

            <Select value={visibility} onValueChange={(v) => setVisibility(v as typeof visibility)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public" className="text-xs">
                  Public
                </SelectItem>
                <SelectItem value="unlisted" className="text-xs">
                  Unlisted
                </SelectItem>
                <SelectItem value="private" className="text-xs">
                  Private
                </SelectItem>
              </SelectContent>
            </Select>

            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="flex-1 h-8 text-xs"
                disabled={promoteMutation.isPending}
                onClick={() => promoteMutation.mutate()}
              >
                {promoteMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Rocket className="h-3 w-3 mr-1" />
                )}
                {selectedTarget === '__gallery__' ? 'Publish' : 'Promote'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => setShowPromote(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
