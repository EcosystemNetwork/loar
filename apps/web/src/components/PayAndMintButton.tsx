/**
 * PayAndMintButton — the composed Solana Pay → cNFT mint flow.
 *
 * One button that orchestrates four steps:
 *   1. Create a Solana Pay intent for a small SOL amount (entity unlock fee).
 *   2. Render the `solana:` URL as a QR + mobile-Phantom deeplink.
 *   3. Poll /api/solana-pay/status until paid.
 *   4. On paid, POST /api/solana/episode/mint with the payment signature in
 *      the lineage so the cNFT cryptographically references the payment.
 *
 * The composition turns a payment into an on-chain attribution receipt
 * (the cNFT) in a single user gesture — the killer Frontier demo path.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  CreditCard,
} from 'lucide-react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const DEMO_UNIVERSE = import.meta.env.VITE_SOLANA_DEMO_UNIVERSE as string | undefined;
const CLUSTER =
  (import.meta.env.VITE_SOLANA_CLUSTER as 'devnet' | 'mainnet-beta' | undefined) ?? 'devnet';

type Phase = 'idle' | 'awaiting_pay' | 'paid' | 'minting' | 'done' | 'error';

export interface PayAndMintButtonProps {
  /** Amount in SOL (decimal string) — default 0.01 (devnet demo). */
  amount?: string;
  entityName: string;
  /** Off-chain metadata URI — entity image, IPFS JSON, etc. */
  metadataUri: string;
  /** Optional lineage (entityId, EVM universe) — pinned to the attestation. */
  lineage?: {
    contentId?: string;
    entityId?: string;
    evmUniverseAddress?: string;
  };
  universeAddress?: string;
}

interface Intent {
  reference: string;
  url: string;
  recipient: string;
  amount: string;
  expiresAt: number;
}

interface PayStatus {
  status: 'pending' | 'paid' | 'expired' | 'invalid';
  signature?: string;
  payer?: string;
}

interface MintResult {
  txSignature: string;
  episodePda: string;
}

function explorerTx(s: string): string {
  return `https://explorer.solana.com/tx/${s}?cluster=${CLUSTER}`;
}
function explorerAddr(a: string): string {
  return `https://explorer.solana.com/address/${a}?cluster=${CLUSTER}`;
}
function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return (
    '0x' +
    Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}

export function PayAndMintButton(props: PayAndMintButtonProps) {
  const amount = props.amount ?? '0.01';
  const universeAddress = props.universeAddress ?? DEMO_UNIVERSE;

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [intent, setIntent] = useState<Intent | null>(null);
  const [paySig, setPaySig] = useState<string | null>(null);
  const [mint, setMint] = useState<MintResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, []);

  const reset = useCallback(() => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = null;
    setIntent(null);
    setPaySig(null);
    setMint(null);
    setError(null);
    setPhase('idle');
  }, []);

  // Phase 4 — mint the cNFT, pinning the payment signature in lineage.
  const runMint = useCallback(
    async (signature: string) => {
      if (!universeAddress) {
        setError('No demo Universe configured');
        setPhase('error');
        return;
      }
      setPhase('minting');
      try {
        const title = props.entityName.slice(0, 28);
        const contentHashHex = await sha256Hex(`${props.entityName}::${signature}`);
        const resp = await fetch(`${SERVER_URL}/api/solana/episode/mint`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            universeAddress,
            contentHashHex,
            metadataUri: props.metadataUri,
            title,
            lineage: {
              ...props.lineage,
              // Carry the Solana Pay tx signature as the canonical content id —
              // off-chain reconcilers can verify the cNFT links back to a paid
              // tx on-chain. Bound at 128 chars (matches server schema).
              contentId: (props.lineage?.contentId ?? `solpay:${signature}`).slice(0, 128),
            },
          }),
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
          throw new Error(body.error ?? `Mint failed (${resp.status})`);
        }
        const data = (await resp.json()) as MintResult;
        setMint(data);
        setPhase('done');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Mint failed');
        setPhase('error');
      }
    },
    [props.entityName, props.metadataUri, props.lineage, universeAddress]
  );

  // Phase 3 — poll until paid, then chain into mint.
  const beginPolling = useCallback(
    (reference: string, expiresAt: number) => {
      pollRef.current = window.setInterval(async () => {
        try {
          const resp = await fetch(
            `${SERVER_URL}/api/solana-pay/status?reference=${encodeURIComponent(reference)}`,
            { credentials: 'include' }
          );
          if (!resp.ok) return;
          const s = (await resp.json()) as PayStatus;
          if (s.status === 'paid' && s.signature) {
            if (pollRef.current !== null) window.clearInterval(pollRef.current);
            pollRef.current = null;
            setPaySig(s.signature);
            setPhase('paid');
            void runMint(s.signature);
          } else if (s.status === 'expired' || s.status === 'invalid') {
            if (pollRef.current !== null) window.clearInterval(pollRef.current);
            pollRef.current = null;
            setError(`Payment ${s.status}`);
            setPhase('error');
          }
        } catch {
          // Network blip — keep polling.
        }
        if (Date.now() > expiresAt + 5_000 && phase === 'awaiting_pay') {
          if (pollRef.current !== null) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setError('Payment timed out');
          setPhase('error');
        }
      }, 2_500);
    },
    [phase, runMint]
  );

  // Phase 1+2 — create intent, begin polling.
  const start = useCallback(async () => {
    setError(null);
    setPhase('awaiting_pay');
    try {
      const resp = await fetch(`${SERVER_URL}/api/solana-pay/intent`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          label: `Mint cNFT — ${props.entityName.slice(0, 60)}`,
          memo: `mint:${props.lineage?.entityId ?? props.entityName.slice(0, 40)}`,
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: 'Failed' }));
        throw new Error(body.error ?? 'Failed to create payment intent');
      }
      const data = (await resp.json()) as Intent;
      setIntent(data);
      beginPolling(data.reference, data.expiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
      setPhase('error');
    }
  }, [amount, beginPolling, props.entityName, props.lineage?.entityId]);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="border-emerald-700 text-emerald-300 hover:bg-emerald-950/40"
      >
        <CreditCard className="mr-1.5 h-3.5 w-3.5" /> Pay & Mint cNFT
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) reset();
          setOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Solana Pay → Mint cNFT</DialogTitle>
          </DialogHeader>

          {phase === 'idle' && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                One gesture: pay {amount} SOL and your entity{' '}
                <span className="font-medium text-foreground">{props.entityName}</span> mints as a
                compressed NFT on Solana {CLUSTER}. The cNFT's lineage will cryptographically
                reference your payment tx.
              </p>
              <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-400 space-y-1">
                <div>1. Create a Solana Pay intent</div>
                <div>2. Scan with Phantom / Solflare</div>
                <div>3. On confirmation → auto-mint cNFT</div>
                <div>4. Cross-chain attestation receipt published</div>
              </div>
              <Button
                onClick={() => void start()}
                className="w-full bg-emerald-600 hover:bg-emerald-500"
              >
                Start
              </Button>
            </div>
          )}

          {phase === 'awaiting_pay' && intent && (
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-md bg-white p-2">
                <QRCodeSVG value={intent.url} size={192} level="M" />
              </div>
              <div className="text-center text-xs text-neutral-400">
                Step 2 / 4 — awaiting payment of {amount} SOL
              </div>
              {isMobile() && (
                <a
                  href={intent.url}
                  className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white"
                >
                  Open in Phantom
                </a>
              )}
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <Loader2 className="h-3 w-3 animate-spin" /> polling /api/solana-pay/status
              </div>
            </div>
          )}

          {phase === 'paid' && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-emerald-700 bg-emerald-950/30 p-3 text-emerald-300">
                <CheckCircle2 className="mb-0.5 inline h-4 w-4" /> Payment confirmed.
              </div>
              {paySig && (
                <a
                  href={explorerTx(paySig)}
                  target="_blank"
                  rel="noreferrer"
                  className="block font-mono text-xs hover:text-emerald-400"
                >
                  Pay tx: {paySig.slice(0, 16)}… <ExternalLink className="inline h-3 w-3" />
                </a>
              )}
              <div className="flex items-center gap-1.5 text-xs text-purple-400">
                <Sparkles className="h-3 w-3 animate-pulse" /> Step 3 / 4 — minting cNFT…
              </div>
            </div>
          )}

          {phase === 'minting' && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
              <p className="text-sm text-muted-foreground">Minting Bubblegum cNFT…</p>
            </div>
          )}

          {phase === 'done' && mint && (
            <div className="space-y-3">
              <div className="rounded-md border border-emerald-700 bg-emerald-950/30 p-3 text-sm text-emerald-300">
                <CheckCircle2 className="mb-0.5 inline h-4 w-4" /> Done. cNFT in your wallet,
                receipt published.
              </div>
              <div className="space-y-1 font-mono text-xs">
                {paySig && (
                  <a
                    href={explorerTx(paySig)}
                    target="_blank"
                    rel="noreferrer"
                    className="block hover:text-emerald-400"
                  >
                    1. Pay tx: {paySig.slice(0, 16)}… <ExternalLink className="inline h-3 w-3" />
                  </a>
                )}
                <a
                  href={explorerTx(mint.txSignature)}
                  target="_blank"
                  rel="noreferrer"
                  className="block hover:text-purple-400"
                >
                  2. Mint tx: {mint.txSignature.slice(0, 16)}…
                  <ExternalLink className="inline h-3 w-3" />
                </a>
                <a
                  href={explorerAddr(mint.episodePda)}
                  target="_blank"
                  rel="noreferrer"
                  className="block hover:text-purple-400"
                >
                  3. Episode PDA: {mint.episodePda.slice(0, 12)}…
                  <ExternalLink className="inline h-3 w-3" />
                </a>
                <a
                  href={`${SERVER_URL}/api/solana/attestation/${mint.episodePda}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block hover:text-purple-400"
                >
                  4. Attestation receipt JSON <ExternalLink className="inline h-3 w-3" />
                </a>
              </div>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-3">
              <div className="rounded-md border border-red-700 bg-red-950/30 p-3 text-sm text-red-300">
                <AlertCircle className="mb-0.5 inline h-4 w-4" /> {error ?? 'Failed'}
              </div>
              <Button size="sm" onClick={reset}>
                Start over
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
