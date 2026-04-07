/**
 * MediaAttachPanel — shown after a file upload completes.
 * Lets the user connect the uploaded file to any entity or universe in their
 * worldbuilding hierarchy: person, place, faction, universe, etc.
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { trpcClient } from '@/utils/trpc';
import { useAttachMedia, type MediaCategory, type AttachmentTargetType } from '@/hooks/useMediaAttachments';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CheckCircle2, Link2, Search } from 'lucide-react';
import { toast } from 'sonner';

const CATEGORY_OPTIONS: { value: MediaCategory; label: string }[] = [
  { value: 'image', label: 'Image / Artwork' },
  { value: 'video', label: 'Video / Animation' },
  { value: 'music', label: 'Music / Score' },
  { value: 'sound', label: 'Sound Effect' },
  { value: 'environment', label: 'Environment / Ambiance' },
  { value: '3d', label: '3D Model / Scene' },
  { value: 'document', label: 'Document / Script' },
  { value: 'design', label: 'Design File' },
  { value: 'other', label: 'Other' },
];

function inferCategory(mimeType: string, filename: string): MediaCategory {
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType === 'application/pdf') return 'document';
  if (['model/gltf+json', 'model/gltf-binary', 'model/obj', 'model/stl'].includes(mimeType))
    return '3d';
  if (/\.(blend|fbx|ma|mb|c4d|dae|abc|3ds|lwo|zpr|ztl)$/i.test(filename)) return '3d';
  if (
    /\.(psd|psb|ai|eps|xcf|kra|clip|procreate|sketch|afdesign|afphoto|afpub|cdr)$/i.test(
      filename
    )
  )
    return 'design';
  if (/\.(exr|hdr|tga|dds)$/i.test(filename)) return 'image';
  if (mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a|aiff)$/i.test(filename))
    return 'sound';
  if (mimeType.startsWith('image/')) return 'image';
  return 'other';
}

interface MediaAttachPanelProps {
  contentHash: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  url: string;
  onAttached?: () => void;
  onSkip?: () => void;
}

export function MediaAttachPanel({
  contentHash,
  originalFilename,
  mimeType,
  size,
  url,
  onAttached,
  onSkip,
}: MediaAttachPanelProps) {
  const { address } = useAccount();
  const attach = useAttachMedia();

  const [targetType, setTargetType] = useState<AttachmentTargetType>('entity');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [category, setCategory] = useState<MediaCategory>(
    inferCategory(mimeType, originalFilename)
  );
  const [label, setLabel] = useState('');

  const { data: universes = [] } = useQuery({
    queryKey: ['universes-by-creator', address],
    queryFn: () => trpcClient.universes.getByCreator.query({ creator: address! }),
    enabled: !!address && targetType === 'universe',
  });

  const { data: entitiesResult } = useQuery({
    queryKey: ['entities-by-creator', address],
    queryFn: () => trpcClient.entities.listByCreator.query({ creator: address! }),
    enabled: !!address && targetType === 'entity',
  });
  const entities = (entitiesResult as any)?.entities ?? [];

  const filteredItems = useMemo(() => {
    const term = search.toLowerCase();
    if (targetType === 'universe') {
      return (universes as any[])
        .filter(
          (u) =>
            !term ||
            u.description?.toLowerCase().includes(term) ||
            u.address?.toLowerCase().includes(term)
        )
        .map((u) => ({
          id: u.address as string,
          name: (u.description as string) ?? (u.address as string),
          sub: ((u.address as string) ?? '').slice(0, 10) + '…',
        }));
    }
    return (entities as any[])
      .filter((e) => !term || (e.name as string)?.toLowerCase().includes(term))
      .map((e) => ({ id: e.id as string, name: e.name as string, sub: e.kind as string }));
  }, [universes, entities, targetType, search]);

  const handleAttach = async () => {
    if (!selectedId) {
      toast.error('Select a target first');
      return;
    }
    try {
      await attach.mutateAsync({
        contentHash,
        originalFilename,
        mimeType,
        size,
        url,
        targetType,
        targetId: selectedId,
        targetName: selectedName,
        category,
        label: label.trim() || originalFilename,
      });
      toast.success(`Attached to ${selectedName}`);
      onAttached?.();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to attach');
    }
  };

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Link2 className="w-4 h-4" />
          Attach to your world
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Link this file to a universe, character, place, or any entity in your hierarchy.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Target type toggle */}
        <div className="flex gap-2 flex-wrap">
          {(['entity', 'universe'] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={targetType === t ? 'default' : 'outline'}
              className="h-7 text-xs"
              onClick={() => {
                setTargetType(t);
                setSelectedId('');
                setSelectedName('');
                setSearch('');
              }}
            >
              {t === 'universe' ? 'Universe' : 'Character / Place / Entity'}
            </Button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={
              targetType === 'universe'
                ? 'Search universes…'
                : 'Search people, places, factions…'
            }
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Item list */}
        <div className="max-h-36 overflow-y-auto space-y-0.5 rounded-md border bg-background p-1">
          {filteredItems.length === 0 && (
            <p className="text-xs text-center text-muted-foreground py-3">
              No {targetType === 'universe' ? 'universes' : 'entities'} found
            </p>
          )}
          {filteredItems.map((item) => (
            <button
              key={item.id}
              className={`w-full text-left px-2.5 py-1.5 rounded text-sm flex items-center justify-between gap-2 hover:bg-accent transition-colors ${
                selectedId === item.id ? 'bg-primary/10 border border-primary/20' : ''
              }`}
              onClick={() => {
                setSelectedId(item.id);
                setSelectedName(item.name);
              }}
            >
              <span className="truncate">{item.name}</span>
              <div className="flex items-center gap-1 shrink-0">
                {item.sub && (
                  <Badge variant="outline" className="text-xs py-0 h-4">
                    {item.sub}
                  </Badge>
                )}
                {selectedId === item.id && <CheckCircle2 className="w-3 h-3 text-primary" />}
              </div>
            </button>
          ))}
        </div>

        {/* Category + Label */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as MediaCategory)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              Label <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              placeholder='e.g. "Theme Song"'
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          {onSkip && (
            <Button variant="ghost" size="sm" onClick={onSkip} className="h-7 text-xs">
              Skip
            </Button>
          )}
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleAttach}
            disabled={!selectedId || attach.isPending}
          >
            {attach.isPending ? 'Attaching…' : `Attach${selectedName ? ` to ${selectedName}` : ''}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
