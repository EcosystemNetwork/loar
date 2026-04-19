import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ContentLaneBadge } from '@/components/ContentLaneBadge';
import {
  Users,
  MapPin,
  Package,
  Swords,
  Zap,
  BookOpen,
  Dna,
  Layers,
  Cpu,
  Building2,
  GitBranch,
  Eye,
  Box,
  Hexagon,
  Castle,
  Crown,
  Heart,
  Flag,
} from 'lucide-react';
import { FlagDialog } from './FlagDialog';
import type { WikiEntity } from './types';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  person: Users,
  place: MapPin,
  thing: Package,
  faction: Swords,
  event: Zap,
  lore: BookOpen,
  species: Dna,
  vehicle: Layers,
  technology: Cpu,
  organization: Building2,
  timeline: GitBranch,
  reality: Eye,
  dimension: Box,
  plane: Hexagon,
  realm: Castle,
  domain: Crown,
};

interface EntityCardProps {
  entity: WikiEntity;
  showActions?: boolean;
}

export function EntityCard({ entity, showActions = true }: EntityCardProps) {
  const KindIcon = KIND_ICONS[entity.kind] ?? Package;
  const { isAuthenticated } = useWalletAuth();
  const queryClient = useQueryClient();
  const [flagOpen, setFlagOpen] = useState(false);

  const classification: 'fan' | 'original' | 'licensed' = entity.rightsDeclaration ?? 'fan';

  const { data: likedData } = useQuery({
    queryKey: ['social', 'isLiked', entity.id],
    queryFn: () => trpcClient.social.isLiked.query({ targetId: entity.id }),
    enabled: !!isAuthenticated && !!showActions,
  });
  const isLiked = !!likedData?.liked;

  const like = useMutation({
    mutationFn: (next: boolean) =>
      next
        ? trpcClient.social.like.mutate({ targetId: entity.id, targetType: 'entity' })
        : trpcClient.social.unlike.mutate({ targetId: entity.id }),
    onSuccess: (_data, next) => {
      queryClient.setQueryData(['social', 'isLiked', entity.id], { liked: next });
      queryClient.invalidateQueries({ queryKey: ['social', 'getLikeCount', entity.id] });
      queryClient.invalidateQueries({ queryKey: ['wiki', 'bookmarks'] });
    },
    onError: (err) => toast.error(err.message || 'Failed'),
  });

  return (
    <>
      <Card className="hover:shadow-lg transition-shadow h-full overflow-hidden group relative">
        <Link to="/wiki/entity/$id" params={{ id: entity.id }} className="block">
          <div className="aspect-video w-full overflow-hidden relative bg-muted">
            <div className="absolute inset-0 flex items-center justify-center">
              <KindIcon className="h-10 w-10 text-muted-foreground/30" />
            </div>
            {entity.imageUrl && (
              <img
                src={resolveIpfsUrl(entity.imageUrl)}
                alt={entity.name}
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            )}
            <div className="absolute top-2 left-2">
              <ContentLaneBadge classification={classification} size="sm" />
            </div>
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-base leading-snug">{entity.name}</CardTitle>
          </CardHeader>
          <CardContent>
            {entity.description && (
              <p className="text-sm text-muted-foreground line-clamp-3">{entity.description}</p>
            )}
            {entity.universeAddress && (
              <Badge variant="outline" className="mt-2 text-xs font-mono truncate max-w-full">
                {entity.universeAddress.slice(0, 10)}...
              </Badge>
            )}
          </CardContent>
        </Link>
        {showActions && isAuthenticated && (
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              size="icon"
              variant="secondary"
              className="h-7 w-7 bg-black/60 hover:bg-black/80 border-0"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                like.mutate(!isLiked);
              }}
              title={isLiked ? 'Remove bookmark' : 'Bookmark'}
              aria-label={isLiked ? 'Remove bookmark' : 'Bookmark'}
            >
              <Heart
                className={`h-3.5 w-3.5 ${isLiked ? 'fill-red-500 text-red-500' : 'text-white'}`}
              />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              className="h-7 w-7 bg-black/60 hover:bg-black/80 border-0"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setFlagOpen(true);
              }}
              title="Report"
              aria-label="Report"
            >
              <Flag className="h-3.5 w-3.5 text-white" />
            </Button>
          </div>
        )}
      </Card>
      <FlagDialog
        open={flagOpen}
        onOpenChange={setFlagOpen}
        contentId={entity.id}
        contentLabel={entity.name}
      />
    </>
  );
}
