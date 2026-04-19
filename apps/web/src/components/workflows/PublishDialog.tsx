import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export type Visibility = 'private' | 'collaborator' | 'paid' | 'canon';

interface Props {
  open: boolean;
  onClose: () => void;
  initialVisibility: Visibility;
  initialCollaborators: string[];
  onSave: (visibility: Visibility, collaboratorUids: string[]) => void;
  saving?: boolean;
}

export function PublishDialog({
  open,
  onClose,
  initialVisibility,
  initialCollaborators,
  onSave,
  saving,
}: Props) {
  const [visibility, setVisibility] = useState<Visibility>(initialVisibility);
  const [collaborators, setCollaborators] = useState<string>(initialCollaborators.join('\n'));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish workflow</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <Label className="text-xs uppercase tracking-wider">Visibility</Label>
            <div className="mt-2 grid grid-cols-1 gap-2">
              {(
                [
                  { v: 'private', label: 'Private', help: 'Only you can run.', disabled: false },
                  {
                    v: 'collaborator',
                    label: 'Collaborator',
                    help: 'Listed wallets can run; nobody else sees it.',
                    disabled: false,
                  },
                  {
                    v: 'paid',
                    label: 'Paid (Phase 2)',
                    help: 'Sell runs in the marketplace.',
                    disabled: true,
                  },
                  {
                    v: 'canon',
                    label: 'Canon-official (Phase 2)',
                    help: 'Universe-blessed preset; admins gate.',
                    disabled: true,
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => setVisibility(opt.v)}
                  className={`rounded-md border p-2 text-left text-sm transition-colors ${
                    visibility === opt.v
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                      : 'border-border hover:bg-muted'
                  } ${opt.disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <div className="font-semibold">{opt.label}</div>
                  <div className="text-[11px] text-muted-foreground">{opt.help}</div>
                </button>
              ))}
            </div>
          </div>

          {visibility === 'collaborator' && (
            <div>
              <Label htmlFor="collabs" className="text-xs uppercase tracking-wider">
                Collaborator UIDs (one per line)
              </Label>
              <Textarea
                id="collabs"
                rows={5}
                value={collaborators}
                onChange={(e) => setCollaborators(e.target.value)}
                placeholder={'0xabc…\n0xdef…'}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave(
                visibility,
                collaborators
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean)
              )
            }
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
