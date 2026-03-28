import { Badge } from '@/components/ui/badge';
import { Sparkles, DollarSign, FileText, Clock, X, Lock } from 'lucide-react';

type ContentLane = 'fan' | 'original' | 'licensed';
type ReviewStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

interface ContentLaneBadgeProps {
  classification: ContentLane;
  reviewStatus?: ReviewStatus;
  size?: 'sm' | 'md';
}

export function ContentLaneBadge({
  classification,
  reviewStatus = 'not_required',
  size = 'md',
}: ContentLaneBadgeProps) {
  if (classification === 'fan') {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-500/50 text-amber-600 dark:text-amber-400"
      >
        <Sparkles className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        {size === 'md' && 'Non-Commercial'}
      </Badge>
    );
  }

  if (classification === 'original') {
    return (
      <Badge variant="default" className="gap-1 bg-blue-600 hover:bg-blue-600 text-white">
        <DollarSign className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        {size === 'md' && 'Creator-Owned'}
      </Badge>
    );
  }

  // licensed — varies by reviewStatus
  if (reviewStatus === 'pending') {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-yellow-500/50 text-yellow-600 dark:text-yellow-400"
      >
        <Clock className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        {size === 'md' && 'Pending Review'}
      </Badge>
    );
  }

  if (reviewStatus === 'rejected') {
    return (
      <Badge variant="destructive" className="gap-1">
        <X className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        {size === 'md' && 'Review Failed'}
      </Badge>
    );
  }

  // approved or not_required (should not happen for licensed, but safe fallback)
  return (
    <Badge
      variant="secondary"
      className="gap-1 bg-green-600/10 text-green-700 dark:text-green-400 border border-green-600/20"
    >
      <Lock className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {size === 'md' && 'Rights-Cleared'}
    </Badge>
  );
}
