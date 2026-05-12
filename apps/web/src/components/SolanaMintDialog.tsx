/**
 * SolanaMintDialog — mint an Episode as a Bubblegum cNFT on Solana devnet.
 *
 * Flow:
 *   1. User clicks "Mint on Solana" on an entity page.
 *   2. Dialog confirms (universe + content hash + metadata URI).
 *   3. POST /api/solana/episode/mint — server composes the Anchor
 *      episode::mint_episode + Bubblegum mint_v1 ixs, Circle DCW signs.
 *   4. Display tx signature + explorer link.
 *
 * Universe resolution:
 *   For v1 we mint every cNFT under the demo Universe address from
 *   VITE_SOLANA_DEMO_UNIVERSE (configured to the deployed demo Universe).
 *   v2: per-creator Solana universes derived from EVM Universe ownership.
 */
import { useCallback, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const DEMO_UNIVERSE = import.meta.env.VITE_SOLANA_DEMO_UNIVERSE as string | undefined;
const CLUSTER =
  (import.meta.env.VITE_SOLANA_CLUSTER as 'devnet' | 'mainnet-beta' | undefined) ?? 'devnet';

type Status = 'idle' | 'minting' | 'done' | 'error';

export interface SolanaMintDialogProps {
  open: boolean;
  onClose: () => void;
  /** Display name of the entity being minted (truncated to 28 bytes for Bubblegum). */
  entityName: string;
  /** Off-chain metadata URI — IPFS / Arweave / HTTPS. */
  metadataUri: string;
  /** Optional override; defaults to VITE_SOLANA_DEMO_UNIVERSE. */
  universeAddress?: string;
  /**
   * Optional off-chain lineage. Persisted as solanaEpisodeLineage/{episodePda}
   * server-side so UIs can join cNFT → LOAR entity → VLM scene index. None of
   * these fields go on-chain; the cNFT's `uri` is the on-chain pointer.
   */
  lineage?: {
    contentId?: string;
    extractionId?: string;
    sceneIndex?: number;
    evmUniverseAddress?: string;
    entityId?: string;
  };
}

interface MintResult {
  txSignature: string;
  episodePda: string;
  leafOwner: string;
  state: string;
}

/** SHA-256 of a string, returned as 0x-prefixed hex. Uses Web Crypto API. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return '0x' + hex;
}

function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
}
function explorerAddr(a: string): string {
  return `https://explorer.solana.com/address/${a}?cluster=${CLUSTER}`;
}

export function SolanaMintDialog(props: SolanaMintDialogProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<MintResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const universeAddress = props.universeAddress ?? DEMO_UNIVERSE;
  const canMint = Boolean(universeAddress) && status === 'idle';

  const handleMint = useCallback(async () => {
    if (!universeAddress) return;
    setStatus('minting');
    setError(null);
    try {
      // Bubblegum metadata name max is 32 bytes — slice generously by char
      // to leave room for multi-byte UTF-8.
      const title = props.entityName.slice(0, 28);
      // Fresh content hash per mint so a creator can mint multiple cNFTs
      // for the same entity (e.g. different revisions). The on-chain
      // EpisodeRecord PDA is keyed by (universe, content_hash) so the hash
      // must be unique per mint.
      const contentHashHex = await sha256Hex(`${props.entityName}::${Date.now()}`);

      const resp = await fetch(`${SERVER_URL}/api/solana/episode/mint`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          universeAddress,
          contentHashHex,
          metadataUri: props.metadataUri,
          title,
          ...(props.lineage ? { lineage: props.lineage } : {}),
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(body.error ?? `Mint failed (${resp.status})`);
      }
      const data = (await resp.json()) as MintResult;
      setResult(data);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mint failed');
      setStatus('error');
    }
  }, [props.entityName, props.metadataUri, universeAddress]);

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mint on Solana ({CLUSTER})</DialogTitle>
        </DialogHeader>

        {!universeAddress && (
          <div className="rounded-md border border-yellow-700 bg-yellow-950/30 p-3 text-sm text-yellow-300">
            <AlertCircle className="mb-1 inline h-4 w-4" /> No Solana universe configured. Set{' '}
            <code className="text-xs">VITE_SOLANA_DEMO_UNIVERSE</code> in your env.
          </div>
        )}

        {universeAddress && status === 'idle' && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              This mints <span className="font-medium text-foreground">{props.entityName}</span> as
              a compressed NFT (Bubblegum) on Solana devnet. ~$0.0001 per mint, atomic with the
              on-chain episode record.
            </p>
            <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-neutral-500">Universe</span>
                <a
                  href={explorerAddr(universeAddress)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-neutral-300 hover:text-purple-400"
                >
                  {universeAddress.slice(0, 4)}…{universeAddress.slice(-4)}{' '}
                  <ExternalLink className="inline h-3 w-3" />
                </a>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-neutral-500">Cluster</span>
                <span className="text-neutral-300">{CLUSTER}</span>
              </div>
            </div>
          </div>
        )}

        {status === 'minting' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
            <p className="text-sm text-neutral-400">Signing + broadcasting via Circle DCW…</p>
          </div>
        )}

        {status === 'done' && result && (
          <div className="space-y-3">
            <div className="rounded-md border border-green-700 bg-green-950/30 p-3 text-sm text-green-300">
              <CheckCircle2 className="mb-1 inline h-4 w-4" /> Minted. State: {result.state}
            </div>
            <div className="space-y-1.5 text-xs">
              <a
                href={explorerTx(result.txSignature)}
                target="_blank"
                rel="noreferrer"
                className="block font-mono text-neutral-300 hover:text-purple-400"
              >
                Tx: {result.txSignature.slice(0, 16)}… <ExternalLink className="inline h-3 w-3" />
              </a>
              <a
                href={explorerAddr(result.episodePda)}
                target="_blank"
                rel="noreferrer"
                className="block font-mono text-neutral-300 hover:text-purple-400"
              >
                Episode PDA: {result.episodePda.slice(0, 8)}…
                <ExternalLink className="inline h-3 w-3" />
              </a>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-3">
            <div className="rounded-md border border-red-700 bg-red-950/30 p-3 text-sm text-red-300">
              <AlertCircle className="mb-1 inline h-4 w-4" /> {error ?? 'Mint failed'}
            </div>
          </div>
        )}

        <div className="mt-2 flex justify-end gap-2">
          {status === 'idle' && (
            <>
              <Button variant="ghost" size="sm" onClick={props.onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!canMint}
                onClick={() => void handleMint()}
                className="bg-purple-600 hover:bg-purple-500"
              >
                Mint cNFT
              </Button>
            </>
          )}
          {(status === 'done' || status === 'error') && (
            <Button size="sm" onClick={props.onClose}>
              Close
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
