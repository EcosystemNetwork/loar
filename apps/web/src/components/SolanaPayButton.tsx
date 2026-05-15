/**
 * Solana Pay button — creates an intent, renders QR + Phantom deeplink,
 * polls /api/solana-pay/status until paid/expired/invalid, then fires onPaid.
 *
 * Usage:
 *   <SolanaPayButton
 *     amount="0.05"
 *     label="Generate cinematic scene"
 *     memo={`gen:${generationId}`}
 *     onPaid={(signature) => triggerGeneration(signature)}
 *   />
 *
 * Two payment paths supported automatically:
 *   - Desktop: scan QR with Phantom mobile
 *   - Mobile:  "Open in Phantom" button (Solana Pay URL deeplink)
 */
import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

type Status = 'idle' | 'creating' | 'awaiting' | 'paid' | 'expired' | 'invalid' | 'error';

export interface SolanaPayButtonProps {
  amount: string;
  /** Optional SPL token mint (base58). Omit for native SOL. */
  splToken?: string;
  label?: string;
  memo?: string;
  /** Polling interval in ms. Default 2_500. */
  pollMs?: number;
  /** Fires once the on-chain payment is confirmed and validated. */
  onPaid?: (info: { signature: string; payer?: string }) => void;
  /** Fires on terminal failure (expired or invalid). */
  onFailed?: (status: 'expired' | 'invalid') => void;
}

interface Intent {
  reference: string;
  url: string;
  recipient: string;
  amount: string;
  splToken?: string;
  expiresAt: number;
}

function isLikelyMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * iOS Solana Pay deeplink helpers.
 *
 * Plain `solana:` URIs only resolve if a wallet has claimed the scheme.
 * Universal links bypass that — they open the wallet's installed app or
 * fall through to the App Store. Each wallet uses its own host:
 *   - Phantom:  phantom.app/ul/browse/<encoded-solana-uri>
 *   - Solflare: solflare.com/ul/v1/browse/<encoded-solana-uri>
 *   - Backpack: backpack.app/ul/v1/browse/<encoded-solana-uri>
 */
function phantomUniversalLink(solanaUri: string): string {
  return `https://phantom.app/ul/browse/${encodeURIComponent(solanaUri)}?ref=${encodeURIComponent(window.location.origin)}`;
}
function solflareUniversalLink(solanaUri: string): string {
  return `https://solflare.com/ul/v1/browse/${encodeURIComponent(solanaUri)}?ref=${encodeURIComponent(window.location.origin)}`;
}
function backpackUniversalLink(solanaUri: string): string {
  return `https://backpack.app/ul/v1/browse/${encodeURIComponent(solanaUri)}?ref=${encodeURIComponent(window.location.origin)}`;
}

export function SolanaPayButton(props: SolanaPayButtonProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [intent, setIntent] = useState<Intent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // Cleanup any running poller on unmount.
  useEffect(() => {
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, []);

  async function startPayment() {
    setStatus('creating');
    setError(null);
    try {
      const resp = await fetch(`${SERVER_URL}/api/solana-pay/intent`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: props.amount,
          splToken: props.splToken,
          label: props.label,
          memo: props.memo,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Failed' }));
        throw new Error(err.error ?? 'Failed to create payment intent');
      }
      const created = (await resp.json()) as Intent;
      setIntent(created);
      setStatus('awaiting');
      beginPolling(created.reference, created.expiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setStatus('error');
    }
  }

  function beginPolling(reference: string, expiresAt: number) {
    const interval = props.pollMs ?? 2_500;
    pollRef.current = window.setInterval(async () => {
      try {
        const resp = await fetch(
          `${SERVER_URL}/api/solana-pay/status?reference=${encodeURIComponent(reference)}`,
          { credentials: 'include' }
        );
        if (!resp.ok) return;
        const s = (await resp.json()) as {
          status: 'pending' | 'paid' | 'expired' | 'invalid';
          signature?: string;
          payer?: string;
        };
        if (s.status === 'paid') {
          stopPolling();
          setStatus('paid');
          if (s.signature) props.onPaid?.({ signature: s.signature, payer: s.payer });
        } else if (s.status === 'expired' || s.status === 'invalid') {
          stopPolling();
          setStatus(s.status);
          props.onFailed?.(s.status);
        }
      } catch {
        // Network blip — keep polling.
      }
      if (Date.now() > expiresAt + 5_000) {
        stopPolling();
        if (status === 'awaiting') {
          setStatus('expired');
          props.onFailed?.('expired');
        }
      }
    }, interval);
  }

  function stopPolling() {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function reset() {
    stopPolling();
    setIntent(null);
    setStatus('idle');
    setError(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (status === 'paid') {
    return (
      <div className="rounded-lg border border-green-700 bg-green-950/30 p-4 text-sm text-green-300">
        ✓ Payment confirmed.
      </div>
    );
  }

  if (status === 'idle' || status === 'creating') {
    return (
      <button
        type="button"
        onClick={() => void startPayment()}
        disabled={status === 'creating'}
        className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
      >
        {status === 'creating'
          ? 'Preparing…'
          : `Pay ${props.amount} ${props.splToken ? 'tokens' : 'SOL'}`}
      </button>
    );
  }

  if (status === 'error') {
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-red-700 bg-red-950/30 p-3 text-sm text-red-300">
          {error ?? 'Payment setup failed'}
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-neutral-700 px-3 py-1 text-sm text-white hover:bg-neutral-600"
        >
          Retry
        </button>
      </div>
    );
  }

  if (status === 'expired' || status === 'invalid') {
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-yellow-700 bg-yellow-950/30 p-3 text-sm text-yellow-300">
          Payment {status}.{' '}
          {status === 'invalid' && 'Amount or recipient mismatch — your funds were not credited.'}
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-neutral-700 px-3 py-1 text-sm text-white hover:bg-neutral-600"
        >
          Start over
        </button>
      </div>
    );
  }

  // status === 'awaiting'
  const url = intent!.url;
  const mobile = isLikelyMobile();
  const ios = isIOS();
  return (
    <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="flex flex-col items-center gap-3">
        <div className="rounded-md bg-white p-2">
          <QRCodeSVG value={url} size={192} level="M" />
        </div>
        <p className="text-xs text-neutral-400">
          Scan with Phantom, Solflare, Backpack, or any Solana Pay wallet
        </p>

        {/* Mobile: wallet-specific buttons.
            On iOS the bare solana: URI doesn't reliably route — use each
            wallet's universal link. Android handles solana: natively. */}
        {mobile && (
          <div className="flex w-full flex-col gap-2">
            <a
              href={ios ? phantomUniversalLink(url) : url}
              target="_blank"
              rel="noopener"
              className="w-full rounded-md bg-purple-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-purple-500"
            >
              Open in Phantom
            </a>
            {ios && (
              <>
                <a
                  href={solflareUniversalLink(url)}
                  target="_blank"
                  rel="noopener"
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-neutral-800"
                >
                  Open in Solflare
                </a>
                <a
                  href={backpackUniversalLink(url)}
                  target="_blank"
                  rel="noopener"
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-neutral-800"
                >
                  Open in Backpack
                </a>
              </>
            )}
          </div>
        )}

        {/* Universal fallback: copy the solana: URI so the user can paste it
            into whatever wallet they actually use. */}
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
            } catch {
              // Fallback: legacy execCommand path.
              const ta = document.createElement('textarea');
              ta.value = url;
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              document.body.removeChild(ta);
            }
          }}
          className="text-xs text-neutral-400 underline hover:text-neutral-200"
        >
          Copy payment link
        </button>

        <p className="text-xs text-neutral-500">
          {props.amount} {props.splToken ? 'tokens' : 'SOL'} → {intent!.recipient.slice(0, 4)}…
          {intent!.recipient.slice(-4)}
        </p>
        <button
          type="button"
          onClick={reset}
          className="text-xs text-neutral-500 underline hover:text-neutral-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
