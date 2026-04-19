/**
 * Compact badge summarizing a VLM risk score.
 * Plug into content cards and admin queue rows.
 */
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ShieldCheck, ShieldAlert } from 'lucide-react';

export interface RiskBadgeProps {
  risk?: {
    overallRisk?: 'low' | 'medium' | 'high';
    autoAction?: 'none' | 'flag' | 'hide_pending_review';
    scores?: Array<{ kind: string; score: number }>;
  } | null;
  compact?: boolean;
}

const LEVEL_COLOR = {
  low: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  high: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
} as const;

export function RiskBadge({ risk, compact }: RiskBadgeProps) {
  if (!risk?.overallRisk) {
    return compact ? null : (
      <Badge variant="outline" className="text-[10px] opacity-70">
        no scan
      </Badge>
    );
  }
  const level = risk.overallRisk;
  const top = risk.scores
    ?.slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((s) => s.kind);
  const Icon = level === 'high' ? ShieldAlert : level === 'medium' ? AlertTriangle : ShieldCheck;
  return (
    <Badge className={`${LEVEL_COLOR[level]} text-[10px] border`} variant="outline">
      <Icon className="h-3 w-3 mr-1" />
      {compact ? level : `${level}${top?.length ? ` · ${top.join(', ')}` : ''}`}
      {risk.autoAction === 'hide_pending_review' ? ' · auto-review' : null}
    </Badge>
  );
}
