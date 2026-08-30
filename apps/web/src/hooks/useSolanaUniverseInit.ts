/**
 * useSolanaUniverseInit — deploy a Universe PDA on Solana.
 *
 * Wraps `POST /api/solana/universe/initialize`. The server maps the caller's
 * session to a Circle-managed Solana wallet (auto-provisioned), derives the
 * PDA, and signs + broadcasts the Anchor `initialize_universe` ix — there is
 * no browser wallet-adapter step. It also writes the Firestore mirror
 * (`createUniverse` with `chainNamespace: 'solana'`), so on success the
 * universe is immediately queryable by its PDA.
 *
 * Dormant until the build is wired for Solana: the "Solana" option only
 * appears in the chain picker when `VITE_SOLANA_CLUSTER` is set, and the
 * route 500s unless the server has `CIRCLE_*` + `SOLANA_RPC_URL` configured.
 */
import { useMutation } from '@tanstack/react-query';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

export interface SolanaUniverseInitInput {
  name: string;
  imageUrl: string;
  description: string;
  portraitImageUrl?: string;
  /** 'fun' = sandbox (private until launched), 'monetized' = launchpad. */
  universeType?: 'fun' | 'monetized';
  visibility?: 'Private' | 'Public';
}

export interface SolanaUniverseInitResult {
  txSignature: string;
  universePda: string;
  creator: string;
  cluster: string;
  state: string;
}

/** SHA-256 of `input` as a `0x`-prefixed 64-hex-char string (32 bytes). */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `0x${hex}`;
}

export function useSolanaUniverseInit() {
  const mutation = useMutation<SolanaUniverseInitResult, Error, SolanaUniverseInitInput>({
    mutationFn: async (input) => {
      // The on-chain PDA is seeded by (creator, contentHash), so contentHash
      // must be stable for a given universe. Derive it from the identifying
      // fields; plotHash tracks the narrative blurb.
      const contentHashHex = await sha256Hex(`${input.name}\n${input.description}`);
      const plotHashHex = await sha256Hex(input.description || input.name);

      const res = await fetch(`${SERVER_URL}/api/solana/universe/initialize`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentHashHex,
          plotHashHex,
          visibility: input.visibility ?? 'Public',
          name: input.name,
          imageUrl: input.imageUrl,
          portraitImageUrl: input.portraitImageUrl || undefined,
          description: input.description,
          universeType: input.universeType ?? 'fun',
        }),
      });

      const body = (await res.json().catch(() => ({}))) as Partial<SolanaUniverseInitResult> & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error || `Solana universe init failed (${res.status})`);
      }
      return body as SolanaUniverseInitResult;
    },
  });

  return {
    initializeUniverse: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    result: mutation.data ?? null,
    reset: mutation.reset,
  };
}
