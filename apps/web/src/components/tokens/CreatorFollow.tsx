/** Follow button + follower count for a token creator (reuses the platform-wide social.follow). */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, UserCheck, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trpcClient } from '@/utils/trpc';
import { useWalletAccount } from '@/hooks/useWalletAccount';

export function CreatorFollow({ creatorAddress }: { creatorAddress: string }) {
  const { address: me } = useWalletAccount();
  const qc = useQueryClient();
  const uid = creatorAddress.toLowerCase();
  const isSelf = !!me && me.toLowerCase() === uid;

  const counts = useQuery({
    queryKey: ['creator-follow-counts', uid],
    queryFn: () => trpcClient.social.getFollowCounts.query({ uid }),
    staleTime: 30_000,
  });
  const following = useQuery({
    queryKey: ['creator-is-following', uid, me?.toLowerCase()],
    queryFn: () => trpcClient.social.isFollowing.query({ targetUid: uid }),
    enabled: !!me && !isSelf,
    staleTime: 30_000,
  });

  const toggle = useMutation({
    mutationFn: () =>
      following.data?.following
        ? trpcClient.social.unfollow.mutate({ targetUid: uid })
        : trpcClient.social.follow.mutate({ targetUid: uid }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['creator-is-following', uid] });
      qc.invalidateQueries({ queryKey: ['creator-follow-counts', uid] });
    },
  });

  const n = counts.data?.followers ?? 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground tabular-nums">
        <span className="font-semibold text-foreground">{n}</span> follower{n === 1 ? '' : 's'}
      </span>
      {!isSelf && (
        <Button
          size="sm"
          variant={following.data?.following ? 'outline' : 'default'}
          className="gap-1.5"
          disabled={!me || toggle.isPending}
          onClick={() => toggle.mutate()}
          title={me ? undefined : 'Sign in to follow creators'}
        >
          {toggle.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : following.data?.following ? (
            <UserCheck className="h-3.5 w-3.5" />
          ) : (
            <UserPlus className="h-3.5 w-3.5" />
          )}
          {following.data?.following ? 'Following' : 'Follow'}
        </Button>
      )}
    </div>
  );
}
