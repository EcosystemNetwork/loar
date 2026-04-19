import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export type Visibility = 'private' | 'collaborator' | 'paid' | 'canon';

interface Props {
  open: boolean;
  onClose: () => void;
  initialVisibility: Visibility;
  initialCollaborators: string[];
  initialPriceCredits: number;
  initialUniverseAddress: string | null;
  onSave: (patch: {
    visibility: Visibility;
    collaboratorUids: string[];
    priceCredits: number;
    universeAddress: string | null;
  }) => void;
  saving?: boolean;
}

const OPTIONS: ReadonlyArray<{
  v: Visibility;
  label: string;
  help: string;
}> = [
  { v: 'private', label: 'Private', help: 'Only you can run.' },
  {
    v: 'collaborator',
    label: 'Collaborator',
    help: 'Listed wallets can run; nobody else sees it.',
  },
  {
    v: 'paid',
    label: 'Paid',
    help: 'Sell runs in the marketplace. 15% platform fee.',
  },
  {
    v: 'canon',
    label: 'Canon-official',
    help: 'Universe-blessed preset. Requires universe admin.',
  },
];

export function PublishDialog({
  open,
  onClose,
  initialVisibility,
  initialCollaborators,
  initialPriceCredits,
  initialUniverseAddress,
  onSave,
  saving,
}: Props) {
  const [visibility, setVisibility] = useState<Visibility>(initialVisibility);
  const [collaborators, setCollaborators] = useState<string>(initialCollaborators.join('\n'));
  const [priceCredits, setPriceCredits] = useState<number>(initialPriceCredits || 10);
  const [universeAddress, setUniverseAddress] = useState<string>(initialUniverseAddress ?? '');

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
              {OPTIONS.map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setVisibility(opt.v)}
                  className={`rounded-md border p-2 text-left text-sm transition-colors ${
                    visibility === opt.v
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                      : 'border-border hover:bg-muted'
                  }`}
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
                rows={4}
                value={collaborators}
                onChange={(e) => setCollaborators(e.target.value)}
                placeholder={'0xabc…\n0xdef…'}
              />
            </div>
          )}

          {visibility === 'paid' && (
            <div>
              <Label htmlFor="price" className="text-xs uppercase tracking-wider">
                Price (credits per run)
              </Label>
              <Input
                id="price"
                type="number"
                min={1}
                value={priceCredits}
                onChange={(e) => setPriceCredits(Math.max(1, Number(e.target.value) || 1))}
              />
              <div className="mt-1 text-[11px] text-muted-foreground">
                You receive {Math.floor(priceCredits * 0.85)} credits per sale (15% platform fee).
              </div>
            </div>
          )}

          {visibility === 'canon' && (
            <div>
              <Label htmlFor="universe" className="text-xs uppercase tracking-wider">
                Universe address (admin required)
              </Label>
              <Input
                id="universe"
                value={universeAddress}
                placeholder="0x…"
                onChange={(e) => setUniverseAddress(e.target.value)}
              />
              <div className="mt-1 text-[11px] text-muted-foreground">
                Server verifies your wallet is an admin of this universe (single-owner or Safe).
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({
                visibility,
                collaboratorUids: collaborators
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
                priceCredits,
                universeAddress: universeAddress.trim() || null,
              })
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
