/**
 * TxConfirm — "what am I signing?" modal used by every write-contract call.
 *
 * WEB-4: wallet UIs show hex calldata, which 99% of users click through. If
 * an attacker can manipulate the arguments we pass to `writeContractAsync`
 * (MitM on tRPC, a poisoned hook, a tampered RPC response), the wallet
 * popup is useless. Rendering the decoded action (function name, recipient,
 * amount, chain) in-app forces the user to eyeball the high-bit fields
 * before signing.
 *
 * Two entrypoints:
 *
 *   1. Singleton (preferred, used by hooks): call `confirmTx(req)` from
 *      anywhere. It returns a promise that resolves when the user clicks
 *      Confirm or Cancel. Requires `<TxConfirmRoot />` mounted once in the
 *      app tree (main.tsx).
 *
 *   2. Local hook (for pages that want isolated state):
 *      `const { confirm, node } = useTxConfirm(); ... {node}` — see bottom.
 *
 * The singleton is what you want 99% of the time: a wallet write hook
 * shouldn't force every caller to wire plumbing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';

export interface TxConfirmRequest {
  title: string;
  /** Short human description shown above the details. */
  description?: string;
  chainName: string;
  functionName: string;
  /** The contract the tx will hit. Displayed truncated. */
  to: `0x${string}` | string;
  /** Native value being sent, as a human string ("0.1", "0"). */
  valueEth?: string;
  /** Additional rows: [label, value]. Keep ≤6 rows. */
  summary?: Array<[string, string]>;
  /** Optional explicit confirm-button label. */
  confirmLabel?: string;
}

function truncate(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function useTxConfirm() {
  const [open, setOpen] = useState(false);
  const [req, setReq] = useState<TxConfirmRequest | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (request: TxConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setReq(request);
        setOpen(true);
      }),
    []
  );

  const handleClose = useCallback((approved: boolean) => {
    setOpen(false);
    const r = resolverRef.current;
    resolverRef.current = null;
    if (r) r(approved);
  }, []);

  const node = (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose(false);
      }}
    >
      <DialogContent className="sm:max-w-md">
        {req && (
          <>
            <DialogHeader>
              <DialogTitle>{req.title}</DialogTitle>
              {req.description && <DialogDescription>{req.description}</DialogDescription>}
            </DialogHeader>

            <div className="mt-2 space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
              <Row label="Network">{req.chainName}</Row>
              <Row label="Function">
                <code className="rounded bg-background px-1 py-0.5 text-xs">
                  {req.functionName}
                </code>
              </Row>
              <Row label="Contract">
                <code className="text-xs" title={req.to}>
                  {truncate(req.to)}
                </code>
              </Row>
              {req.valueEth !== undefined && req.valueEth !== '0' && (
                <Row label="Value">
                  <span className="font-mono text-xs">{req.valueEth} ETH</span>
                </Row>
              )}
              {req.summary?.map(([k, v], i) => (
                <Row key={i} label={k}>
                  <span className="font-mono text-xs">{v}</span>
                </Row>
              ))}
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              Your wallet will ask you to sign. Check these values match what you see in the wallet
              popup before approving.
            </p>

            <DialogFooter className="mt-3 gap-2 sm:gap-2">
              <Button variant="ghost" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button onClick={() => handleClose(true)}>
                {req.confirmLabel ?? 'Continue to wallet'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  return { confirm, node };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}

// ── Singleton registry ───────────────────────────────────────────────
// WEB-4: hooks (useBondingCurve, useSwapExecution, etc.) can't rely on each
// caller site rendering a dialog node. Instead, the app mounts `<TxConfirmRoot />`
// once at the router root; hooks call `confirmTx(req)` directly.

type TxConfirmHandler = (req: TxConfirmRequest) => Promise<boolean>;
let currentHandler: TxConfirmHandler | null = null;

/** Call from anywhere (hooks, event handlers) to show the confirm modal. */
export async function confirmTx(req: TxConfirmRequest): Promise<boolean> {
  if (!currentHandler) {
    // No root mounted — fail closed rather than silently bypassing the
    // defense. If this ever fires in production, it's a missing render
    // of <TxConfirmRoot /> in main.tsx; better to block the tx than let
    // a potentially-tampered payload through unchecked.
    console.error('[tx-confirm] confirmTx() called but <TxConfirmRoot /> is not mounted');
    return false;
  }
  return currentHandler(req);
}

/** Mount once near the router root. Re-mounts safely swap the handler. */
export function TxConfirmRoot() {
  const { confirm, node } = useTxConfirm();
  useEffect(() => {
    currentHandler = confirm;
    return () => {
      if (currentHandler === confirm) currentHandler = null;
    };
  }, [confirm]);
  return node;
}
