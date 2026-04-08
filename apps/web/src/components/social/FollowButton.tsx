import { trpc } from '../../utils/trpc';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';

export function FollowButton({ targetUid }: { targetUid: string }) {
  const { address } = useAccount();
  const queryClient = useQueryClient();

  // Only query follow status if authenticated
  const { data, isLoading } = trpc.social.isFollowing.useQuery(
    { targetUid },
    { enabled: !!address }
  );

  const follow = trpc.social.follow.useMutation({
    onMutate: async () => {
      // Optimistic update
      await queryClient.cancelQueries({
        queryKey: [['social', 'isFollowing'], { input: { targetUid } }],
      });
      queryClient.setQueryData(
        [['social', 'isFollowing'], { input: { targetUid }, type: 'query' }],
        { following: true }
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [['social', 'isFollowing']] });
      queryClient.invalidateQueries({ queryKey: [['profiles']] });
    },
  });

  const unfollow = trpc.social.unfollow.useMutation({
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: [['social', 'isFollowing'], { input: { targetUid } }],
      });
      queryClient.setQueryData(
        [['social', 'isFollowing'], { input: { targetUid }, type: 'query' }],
        { following: false }
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [['social', 'isFollowing']] });
      queryClient.invalidateQueries({ queryKey: [['profiles']] });
    },
  });

  const isFollowing = data?.following ?? false;
  const isMutating = follow.isPending || unfollow.isPending;

  // Don't show follow button to unauthenticated users
  if (!address) return null;

  return (
    <button
      onClick={() => (isFollowing ? unfollow.mutate({ targetUid }) : follow.mutate({ targetUid }))}
      disabled={isLoading || isMutating}
      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
        isFollowing
          ? 'bg-zinc-800 text-zinc-300 hover:bg-red-900/30 hover:text-red-400 border border-zinc-700'
          : 'bg-violet-600 text-white hover:bg-violet-700'
      } disabled:opacity-50`}
    >
      {isLoading ? '...' : isFollowing ? 'Following' : 'Follow'}
    </button>
  );
}
