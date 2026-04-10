/**
 * Commission Dialog — Request a commission from an artist.
 */
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useRequestCommission } from '@/hooks/useGallery';
import { Loader2 } from 'lucide-react';

interface CommissionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artistUid: string;
  artistName?: string;
  universeId?: string;
}

const MEDIA_TYPES = ['video', 'image', 'audio', '3d', 'character', 'environment', 'other'];

export function CommissionDialog({
  open,
  onOpenChange,
  artistUid,
  artistName,
  universeId,
}: CommissionDialogProps) {
  const [message, setMessage] = useState('');
  const [mediaType, setMediaType] = useState('video');
  const [budget, setBudget] = useState('');

  const commission = useRequestCommission();

  const handleSubmit = async () => {
    await commission.mutateAsync({
      toUid: artistUid,
      message,
      mediaType,
      budget: budget || undefined,
      universeId,
    });
    onOpenChange(false);
    setMessage('');
    setBudget('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Commission {artistName || 'Artist'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Media Type</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {MEDIA_TYPES.map((type) => (
                <Button
                  key={type}
                  variant={mediaType === type ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs capitalize"
                  onClick={() => setMediaType(type)}
                >
                  {type}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <Label>Message</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe what you'd like created..."
              className="mt-1"
              rows={4}
            />
          </div>

          <div>
            <Label>Budget (optional)</Label>
            <Input
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="e.g. 0.1 ETH or 500 credits"
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!message || message.length < 10 || commission.isPending}
          >
            {commission.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Send Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
