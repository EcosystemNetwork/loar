import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const REASONS = [
  { value: 'spam', label: 'Spam' },
  { value: 'copyright', label: 'Copyright infringement' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'offensive', label: 'Offensive / harmful' },
  { value: 'other', label: 'Other' },
] as const;

type ReasonValue = (typeof REASONS)[number]['value'];

interface FlagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentId: string;
  contentLabel?: string;
}

export function FlagDialog({ open, onOpenChange, contentId, contentLabel }: FlagDialogProps) {
  const [reason, setReason] = useState<ReasonValue>('spam');
  const [description, setDescription] = useState('');

  const flag = useMutation({
    mutationFn: () =>
      trpcClient.moderation.flag.mutate({
        contentId,
        reason,
        description: description.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Reported. Thank you — our moderators will review.');
      setDescription('');
      setReason('spam');
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message || 'Failed to submit report'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report content</DialogTitle>
          <DialogDescription>
            {contentLabel ? `Reporting "${contentLabel}".` : 'Reporting this entity.'} Our team
            reviews every report and may remove or restrict content that violates the rules.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-xs font-medium mb-1.5 block">Reason</label>
            <Select value={reason} onValueChange={(v) => setReason(v as ReasonValue)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium mb-1.5 block">Details (optional)</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's wrong with this entity?"
              maxLength={500}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => flag.mutate()} disabled={flag.isPending}>
            {flag.isPending ? 'Submitting…' : 'Submit report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
