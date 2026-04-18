/**
 * CommentSection -- reusable comment thread for universes, episodes, and content.
 *
 * Features:
 *  - Paginated top-level comments with nested replies (1 level)
 *  - Like/unlike with optimistic count
 *  - Delete own comments
 *  - Auth guard for write operations
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import { MessageSquare, Heart, Trash2, Reply, Send, Loader2 } from 'lucide-react';

interface CommentSectionProps {
  targetId: string;
  targetType: 'universe' | 'episode' | 'content';
}

export function CommentSection({ targetId, targetType }: CommentSectionProps) {
  const { isAuthenticated, address } = useWalletAuth();
  const queryClient = useQueryClient();

  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const uid = address?.toLowerCase() ?? '';

  // ── Queries ──────────────────────────────────────────────────────────

  const commentsQueryOpts = trpc.comments.list.queryOptions({
    targetId,
    targetType,
    limit: 25,
  });

  const { data, isLoading, error } = useQuery(commentsQueryOpts);

  // ── Invalidation helper ──────────────────────────────────────────────

  const invalidateComments = () => {
    queryClient.invalidateQueries({ queryKey: commentsQueryOpts.queryKey });
  };

  // ── Mutations ────────────────────────────────────────────────────────

  const addComment = useMutation(
    trpc.comments.add.mutationOptions({
      onSuccess: () => {
        setNewComment('');
        setReplyText('');
        setReplyingTo(null);
        invalidateComments();
      },
      onError: (err: any) => {
        toast.error(err.message || 'Failed to post comment');
      },
    })
  );

  const deleteComment = useMutation(
    trpc.comments.delete.mutationOptions({
      onSuccess: () => {
        invalidateComments();
        toast.success('Comment deleted');
      },
      onError: (err: any) => {
        toast.error(err.message || 'Failed to delete comment');
      },
    })
  );

  const likeComment = useMutation(
    trpc.comments.like.mutationOptions({
      onSuccess: () => invalidateComments(),
    })
  );

  const unlikeComment = useMutation(
    trpc.comments.unlike.mutationOptions({
      onSuccess: () => invalidateComments(),
    })
  );

  // ── Handlers ─────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    addComment.mutate({ targetId, targetType, text: newComment.trim() });
  };

  const handleReplySubmit = (parentId: string) => {
    if (!replyText.trim()) return;
    addComment.mutate({
      targetId,
      targetType,
      text: replyText.trim(),
      parentId,
    });
  };

  const handleToggleLike = (commentId: string, likedBy: string[]) => {
    if (!isAuthenticated) {
      toast.error('Sign in to like comments');
      return;
    }
    if (likedBy.includes(uid)) {
      unlikeComment.mutate({ commentId });
    } else {
      likeComment.mutate({ commentId });
    }
  };

  const handleDelete = (commentId: string) => {
    if (confirm('Delete this comment?')) {
      deleteComment.mutate({ commentId });
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────

  const formatTime = (ts: any) => {
    if (!ts) return '';
    const d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString();
  };

  const truncateAddress = (addr: string) => {
    if (addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // ── Render ───────────────────────────────────────────────────────────

  const comments = data?.comments ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 text-zinc-300">
        <MessageSquare className="h-5 w-5" />
        <h3 className="text-lg font-semibold">
          Comments{comments.length > 0 && ` (${comments.length})`}
        </h3>
      </div>

      {/* Add comment form */}
      {isAuthenticated ? (
        <form onSubmit={handleSubmit} className="flex gap-3">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Write a comment..."
            rows={2}
            maxLength={2000}
            className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
          <button
            type="submit"
            disabled={!newComment.trim() || addComment.isPending}
            className="flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-lg bg-violet-600 text-white transition hover:bg-violet-500 disabled:opacity-40 disabled:hover:bg-violet-600"
          >
            {addComment.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </form>
      ) : (
        <p className="text-sm text-zinc-500">Sign in to leave a comment.</p>
      )}

      {/* Loading / error */}
      {isLoading && (
        <div className="flex items-center justify-center py-8 text-zinc-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading comments...
        </div>
      )}
      {error && <p className="text-sm text-red-400">Failed to load comments.</p>}

      {/* Comment list */}
      {!isLoading && comments.length === 0 && (
        <p className="py-4 text-center text-sm text-zinc-500">No comments yet. Be the first!</p>
      )}

      <div className="space-y-4">
        {comments.map((comment: any) => (
          <div key={comment.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            {/* Top-level comment */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <span className="font-medium text-zinc-200">
                    {comment.authorDisplayName !== comment.authorUid
                      ? comment.authorDisplayName
                      : truncateAddress(comment.authorUid)}
                  </span>
                  <span>{formatTime(comment.createdAt)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{comment.text}</p>
              </div>

              {/* Delete button (own comments only) */}
              {isAuthenticated && comment.authorUid === uid && (
                <button
                  onClick={() => handleDelete(comment.id)}
                  className="shrink-0 rounded p-1 text-zinc-600 transition hover:bg-zinc-800 hover:text-red-400"
                  title="Delete comment"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Actions */}
            <div className="mt-2 flex items-center gap-4">
              <button
                onClick={() => handleToggleLike(comment.id, comment.likedBy ?? [])}
                className={`flex items-center gap-1 text-xs transition ${
                  (comment.likedBy ?? []).includes(uid)
                    ? 'text-rose-400'
                    : 'text-zinc-500 hover:text-rose-400'
                }`}
              >
                <Heart
                  className="h-3.5 w-3.5"
                  fill={(comment.likedBy ?? []).includes(uid) ? 'currentColor' : 'none'}
                />
                {comment.likes > 0 && <span>{comment.likes}</span>}
              </button>

              {isAuthenticated && (
                <button
                  onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                  className="flex items-center gap-1 text-xs text-zinc-500 transition hover:text-violet-400"
                >
                  <Reply className="h-3.5 w-3.5" />
                  Reply
                </button>
              )}
            </div>

            {/* Reply form */}
            {replyingTo === comment.id && (
              <div className="mt-3 flex gap-2 pl-4">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a reply..."
                  rows={1}
                  maxLength={2000}
                  className="flex-1 resize-none rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
                <button
                  onClick={() => handleReplySubmit(comment.id)}
                  disabled={!replyText.trim() || addComment.isPending}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-violet-600 text-white transition hover:bg-violet-500 disabled:opacity-40"
                >
                  {addComment.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            )}

            {/* Replies */}
            {comment.replies?.length > 0 && (
              <div className="mt-3 space-y-3 border-l-2 border-zinc-700/50 pl-4">
                {comment.replies.map((reply: any) => (
                  <div key={reply.id} className="space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                          <span className="font-medium text-zinc-200">
                            {reply.authorDisplayName !== reply.authorUid
                              ? reply.authorDisplayName
                              : truncateAddress(reply.authorUid)}
                          </span>
                          <span>{formatTime(reply.createdAt)}</span>
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-300">
                          {reply.text}
                        </p>
                      </div>
                      {isAuthenticated && reply.authorUid === uid && (
                        <button
                          onClick={() => handleDelete(reply.id)}
                          className="shrink-0 rounded p-1 text-zinc-600 transition hover:bg-zinc-800 hover:text-red-400"
                          title="Delete reply"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {/* Reply like */}
                    <button
                      onClick={() => handleToggleLike(reply.id, reply.likedBy ?? [])}
                      className={`flex items-center gap-1 text-xs transition ${
                        (reply.likedBy ?? []).includes(uid)
                          ? 'text-rose-400'
                          : 'text-zinc-500 hover:text-rose-400'
                      }`}
                    >
                      <Heart
                        className="h-3 w-3"
                        fill={(reply.likedBy ?? []).includes(uid) ? 'currentColor' : 'none'}
                      />
                      {reply.likes > 0 && <span>{reply.likes}</span>}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Load more */}
      {data?.nextCursor && (
        <div className="text-center">
          <button
            onClick={() => {
              // For now, users can use scroll or future infinite query
              toast.info('Pagination coming soon');
            }}
            className="text-sm text-violet-400 transition hover:text-violet-300"
          >
            Load more comments...
          </button>
        </div>
      )}
    </div>
  );
}
