/**
 * BatchMintEpisodesDialog — multi-row form for creators to list several
 * episode NFTs in a single Firestore batch. Hands off to
 * `nft.batchCreateEpisodeListing` which is atomic (all-or-nothing).
 *
 * Shared defaults (price, max supply, royalty) apply to every row and can be
 * overridden per-row. On-chain minting still happens lazily per buyer —
 * this endpoint only records the listings.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { parseEther } from 'viem';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useBatchCreateEpisodeListings } from '@/hooks/useRevenue';

interface EpisodeRow {
  localId: string;
  title: string;
  description: string;
  nodeId: string;
  contentHash: string;
  mediaUrl: string;
  thumbnailUrl: string;
  metadataURI: string;
  mintPriceEth: string;
  maxSupply: string;
  royaltyBps: string;
}

function blankRow(): EpisodeRow {
  return {
    localId: Math.random().toString(36).slice(2, 10),
    title: '',
    description: '',
    nodeId: '',
    contentHash: '',
    mediaUrl: '',
    thumbnailUrl: '',
    metadataURI: '',
    mintPriceEth: '',
    maxSupply: '',
    royaltyBps: '',
  };
}

interface Props {
  universeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (count: number) => void;
}

export function BatchMintEpisodesDialog({ universeId, open, onOpenChange, onSuccess }: Props) {
  const batch = useBatchCreateEpisodeListings();
  const [rows, setRows] = useState<EpisodeRow[]>([blankRow(), blankRow()]);
  const [defaultPriceEth, setDefaultPriceEth] = useState('0.01');
  const [defaultMaxSupply, setDefaultMaxSupply] = useState('100');
  const [defaultRoyaltyBps, setDefaultRoyaltyBps] = useState('500');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const MAX_ROWS = 50;

  function addRow() {
    if (rows.length >= MAX_ROWS) return;
    setRows((r) => [...r, blankRow()]);
  }

  function removeRow(localId: string) {
    setRows((r) => (r.length > 1 ? r.filter((row) => row.localId !== localId) : r));
  }

  function updateRow(localId: string, patch: Partial<EpisodeRow>) {
    setRows((r) => r.map((row) => (row.localId === localId ? { ...row, ...patch } : row)));
  }

  async function handleSubmit() {
    setErrorMsg(null);
    const episodes: Parameters<typeof batch.mutateAsync>[0]['episodes'] = [];

    for (const [i, row] of rows.entries()) {
      if (!row.title.trim() || !row.contentHash.trim() || !row.mediaUrl.trim()) {
        setErrorMsg(`Row ${i + 1}: title, content hash, and media URL are required`);
        return;
      }
      const priceEth = row.mintPriceEth.trim() || defaultPriceEth;
      let mintPriceWei: bigint;
      try {
        mintPriceWei = parseEther(priceEth);
      } catch {
        setErrorMsg(`Row ${i + 1}: invalid mint price`);
        return;
      }
      if (mintPriceWei <= 0n) {
        setErrorMsg(`Row ${i + 1}: mint price must be greater than zero`);
        return;
      }
      const nodeIdNum = Number(row.nodeId || '0');
      if (!Number.isFinite(nodeIdNum) || nodeIdNum < 0) {
        setErrorMsg(`Row ${i + 1}: node id must be a non-negative integer`);
        return;
      }
      const maxSupplyNum = Number(row.maxSupply || defaultMaxSupply || '0');
      const royaltyBpsNum = Number(row.royaltyBps || defaultRoyaltyBps || '500');
      if (royaltyBpsNum < 0 || royaltyBpsNum > 10_000) {
        setErrorMsg(`Row ${i + 1}: royalty must be between 0 and 10000 bps`);
        return;
      }

      episodes.push({
        nodeId: nodeIdNum,
        contentHash: row.contentHash.trim(),
        title: row.title.trim(),
        description: row.description.trim(),
        mediaUrl: row.mediaUrl.trim(),
        thumbnailUrl: row.thumbnailUrl.trim() || undefined,
        mintPrice: mintPriceWei.toString(),
        maxSupply: maxSupplyNum,
        royaltyBps: royaltyBpsNum,
        metadataURI: row.metadataURI.trim() || `ipfs://${row.contentHash.trim()}`,
      });
    }

    try {
      const res = await batch.mutateAsync({ universeId, episodes });
      toast.success(`${res.count} episode listings created`);
      onSuccess?.(res.count);
      onOpenChange(false);
      setRows([blankRow(), blankRow()]);
    } catch (err: any) {
      const msg = err?.message ?? 'Batch create failed';
      setErrorMsg(msg);
      toast.error(msg);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Batch-list episodes</DialogTitle>
          <DialogDescription>
            List up to {MAX_ROWS} episodes in one pass. Shared defaults are applied to rows that
            leave those fields empty.
          </DialogDescription>
        </DialogHeader>

        {/* Shared defaults */}
        <div className="grid grid-cols-3 gap-3 py-2 border-b">
          <div className="space-y-1">
            <Label htmlFor="def-price">Default price (ETH)</Label>
            <Input
              id="def-price"
              type="number"
              step="0.001"
              min="0"
              value={defaultPriceEth}
              onChange={(e) => setDefaultPriceEth(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="def-supply">Default max supply</Label>
            <Input
              id="def-supply"
              type="number"
              min="0"
              value={defaultMaxSupply}
              onChange={(e) => setDefaultMaxSupply(e.target.value)}
              placeholder="0 = unlimited"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="def-royalty">Default royalty (bps)</Label>
            <Input
              id="def-royalty"
              type="number"
              min="0"
              max="10000"
              value={defaultRoyaltyBps}
              onChange={(e) => setDefaultRoyaltyBps(e.target.value)}
            />
          </div>
        </div>

        {/* Episode rows */}
        <div className="space-y-3 py-2">
          {rows.map((row, idx) => (
            <div key={row.localId} className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Episode {idx + 1}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => removeRow(row.localId)}
                  disabled={rows.length <= 1}
                  aria-label="Remove row"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Title *"
                  value={row.title}
                  onChange={(e) => updateRow(row.localId, { title: e.target.value })}
                />
                <Input
                  placeholder="Node ID"
                  type="number"
                  min="0"
                  value={row.nodeId}
                  onChange={(e) => updateRow(row.localId, { nodeId: e.target.value })}
                />
              </div>
              <Textarea
                placeholder="Description"
                rows={2}
                value={row.description}
                onChange={(e) => updateRow(row.localId, { description: e.target.value })}
              />
              <Input
                placeholder="Content hash (SHA-256 or IPFS CID) *"
                value={row.contentHash}
                onChange={(e) => updateRow(row.localId, { contentHash: e.target.value })}
                className="font-mono text-xs"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Media URL *"
                  value={row.mediaUrl}
                  onChange={(e) => updateRow(row.localId, { mediaUrl: e.target.value })}
                />
                <Input
                  placeholder="Thumbnail URL"
                  value={row.thumbnailUrl}
                  onChange={(e) => updateRow(row.localId, { thumbnailUrl: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Input
                  placeholder={`Price (ETH) · ${defaultPriceEth}`}
                  type="number"
                  step="0.001"
                  min="0"
                  value={row.mintPriceEth}
                  onChange={(e) => updateRow(row.localId, { mintPriceEth: e.target.value })}
                />
                <Input
                  placeholder={`Max supply · ${defaultMaxSupply}`}
                  type="number"
                  min="0"
                  value={row.maxSupply}
                  onChange={(e) => updateRow(row.localId, { maxSupply: e.target.value })}
                />
                <Input
                  placeholder={`Royalty bps · ${defaultRoyaltyBps}`}
                  type="number"
                  min="0"
                  max="10000"
                  value={row.royaltyBps}
                  onChange={(e) => updateRow(row.localId, { royaltyBps: e.target.value })}
                />
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRow}
            disabled={rows.length >= MAX_ROWS}
            className="gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            Add episode ({rows.length}/{MAX_ROWS})
          </Button>
        </div>

        {errorMsg && (
          <p className="text-xs text-red-500" role="alert">
            {errorMsg}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={batch.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={batch.isPending}>
            {batch.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            List {rows.length} {rows.length === 1 ? 'episode' : 'episodes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
