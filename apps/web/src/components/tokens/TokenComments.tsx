/**
 * TokenComments — Threaded comment section for token detail pages.
 *
 * pump.fun-style social layer: post text/image comments, reply to threads,
 * like comments, with auth-gated interactions.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { AddressDisplay } from '@/components/tokens/AddressDisplay';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  MessageCircle,
  Heart,
  Reply,
  Trash2,
  Send,
  Loader2,
  ChevronDown,
  ImagePlus,
} from 'lucide-react';

interface Comment {
  id: string;
  text: string;
  imageUrl?: string | null;
  authorAddress: string;
  authorUid: string;
  createdAt: any;
  likes: number;
  replyCount?: number;
  parentId?: string | null;
}

export function TokenComments({ tokenAddress }: { tokenAddress: string }) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());

  // Fetch comments
  const { data, isLoading } = useQuery({
    queryKey: ['token-comments', tokenAddress],
    queryFn: () => trpcClient.tokenSocial.getComments.query({ tokenAddress, limit: 50 }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Fetch comment count
  const { data: commentCount } = useQuery({
    queryKey: ['token-comment-count', tokenAddress],
    queryFn: () => trpcClient.tokenSocial.getCommentCount.query({ tokenAddress }),
    staleTime: 30_000,
  });

  // Post comment
  const postComment = useMutation({
    mutationFn: (input: { text: string; parentId?: string | null }) =>
      trpcClient.tokenSocial.addComment.mutate({
        tokenAddress,
        text: input.text,
        parentId: input.parentId ?? null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['token-comments', tokenAddress] });
      queryClient.invalidateQueries({ queryKey: ['token-comment-count', tokenAddress] });
      setNewComment('');
      setReplyTo(null);
      setReplyText('');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to post comment');
    },
  });

  // Delete comment
  const deleteComment = useMutation({
    mutationFn: (commentId: string) => trpcClient.tokenSocial.deleteComment.mutate({ commentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['token-comments', tokenAddress] });
      queryClient.invalidateQueries({ queryKey: ['token-comment-count', tokenAddress] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete comment');
    },
  });

  // Like comment
  const likeComment = useMutation({
    mutationFn: (commentId: string) => trpcClient.tokenSocial.likeComment.mutate({ commentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['token-comments', tokenAddress] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to like comment');
    },
  });

  const toggleReplies = (commentId: string) => {
    setExpandedReplies((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  };

  const formatTime = (ts: any) => {
    if (!ts) return '';
    const date = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  };

  const comments = data?.comments ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Comments</h3>
        {commentCount != null && (
          <Badge variant="outline" className="text-[10px]">
            {commentCount}
          </Badge>
        )}
      </div>

      {/* New comment input */}
      {address ? (
        <div className="flex gap-2">
          <Input
            placeholder="Say something about this token..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newComment.trim()) {
                postComment.mutate({ text: newComment.trim() });
              }
            }}
            className="h-9 text-sm"
            maxLength={1000}
          />
          <Button
            size="sm"
            className="h-9 px-3"
            disabled={!newComment.trim() || postComment.isPending}
            onClick={() => postComment.mutate({ text: newComment.trim() })}
          >
            {postComment.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-2">Connect wallet to comment</p>
      )}

      {/* Comments list */}
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-center py-6 text-sm text-muted-foreground">
          No comments yet. Be the first!
        </p>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {comments.map((comment: Comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              currentUser={address?.toLowerCase()}
              onReply={(id) => {
                setReplyTo(id);
                toggleReplies(id);
              }}
              onDelete={(id) => deleteComment.mutate(id)}
              onLike={(id) => likeComment.mutate(id)}
              formatTime={formatTime}
              isExpanded={expandedReplies.has(comment.id)}
              onToggleReplies={() => toggleReplies(comment.id)}
              replyTo={replyTo}
              replyText={replyText}
              setReplyText={setReplyText}
              onSubmitReply={() => {
                if (replyText.trim()) {
                  postComment.mutate({ text: replyText.trim(), parentId: replyTo });
                }
              }}
              isReplying={postComment.isPending}
              tokenAddress={tokenAddress}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentItem({
  comment,
  currentUser,
  onReply,
  onDelete,
  onLike,
  formatTime,
  isExpanded,
  onToggleReplies,
  replyTo,
  replyText,
  setReplyText,
  onSubmitReply,
  isReplying,
  tokenAddress,
}: {
  comment: Comment;
  currentUser?: string;
  onReply: (id: string) => void;
  onDelete: (id: string) => void;
  onLike: (id: string) => void;
  formatTime: (ts: any) => string;
  isExpanded: boolean;
  onToggleReplies: () => void;
  replyTo: string | null;
  replyText: string;
  setReplyText: (s: string) => void;
  onSubmitReply: () => void;
  isReplying: boolean;
  tokenAddress: string;
}) {
  const isOwn = currentUser === comment.authorUid?.toLowerCase();

  // Fetch replies if expanded
  const { data: replies } = useQuery({
    queryKey: ['token-comment-replies', comment.id],
    queryFn: () => trpcClient.tokenSocial.getReplies.query({ parentId: comment.id }),
    enabled: isExpanded,
    staleTime: 15_000,
  });

  return (
    <div className="group rounded-lg bg-muted/30 p-2.5 text-xs hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <AddressDisplay
              address={comment.authorAddress}
              className="text-[10px] text-muted-foreground"
            />
            <span className="text-[10px] text-muted-foreground">
              {formatTime(comment.createdAt)}
            </span>
          </div>
          <p className="text-sm break-words">{comment.text}</p>
          {comment.imageUrl && (
            <img src={comment.imageUrl} alt="" className="mt-2 max-h-40 rounded-md object-cover" />
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={() => onLike(comment.id)}
          className="flex items-center gap-1 text-muted-foreground hover:text-red-500 transition-colors"
        >
          <Heart className="h-3 w-3" />
          <span className="text-[10px]">{comment.likes || ''}</span>
        </button>
        {currentUser && (
          <button
            onClick={() => onReply(comment.id)}
            className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
          >
            <Reply className="h-3 w-3" />
            <span className="text-[10px]">Reply</span>
          </button>
        )}
        {(comment.replyCount ?? 0) > 0 && (
          <button
            onClick={onToggleReplies}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            />
            <span className="text-[10px]">{comment.replyCount} replies</span>
          </button>
        )}
        {isOwn && (
          <button
            onClick={() => onDelete(comment.id)}
            className="flex items-center gap-1 text-muted-foreground hover:text-red-500 transition-colors ml-auto opacity-0 group-hover:opacity-100"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Reply input */}
      {replyTo === comment.id && (
        <div className="flex gap-2 mt-2 ml-4">
          <Input
            placeholder="Write a reply..."
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && replyText.trim()) onSubmitReply();
            }}
            className="h-7 text-xs"
            maxLength={500}
            autoFocus
          />
          <Button
            size="sm"
            className="h-7 px-2"
            disabled={!replyText.trim() || isReplying}
            onClick={onSubmitReply}
          >
            <Send className="h-2.5 w-2.5" />
          </Button>
        </div>
      )}

      {/* Replies */}
      {isExpanded && replies && replies.length > 0 && (
        <div className="ml-4 mt-2 space-y-1.5 border-l-2 border-muted pl-3">
          {(replies as Comment[]).map((reply) => (
            <div key={reply.id} className="text-xs">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-mono text-[10px] text-muted-foreground">
                  <AddressDisplay
                    address={reply.authorAddress}
                    className="text-[10px] text-muted-foreground"
                  />
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {formatTime(reply.createdAt)}
                </span>
              </div>
              <p className="text-xs break-words">{reply.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
