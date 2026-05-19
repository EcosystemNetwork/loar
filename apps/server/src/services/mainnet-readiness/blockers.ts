/**
 * Mainnet Readiness — programmatic snapshot of the launch blockers tracked
 * in docs/launch-readiness.md.
 *
 * For each blocker we encode:
 *   • What kind of blocker it is (env / manual / external / code)
 *   • How to detect "satisfied" automatically (where possible)
 *   • The owner + estimated unblock effort
 *
 * The check functions are pure — they read process.env or filesystem state.
 * No I/O against external systems (RPC, Firestore) because this endpoint is
 * called from an admin dashboard that polls frequently.
 *
 * Source of truth for the items themselves is docs/launch-readiness.md
 * (single page). This file mirrors the page in code so we can surface live
 * status. If the page changes, update this file in the same commit.
 */

export type BlockerCategory = 'operational' | 'external' | 'code' | 'legal';
export type BlockerStatus = 'ready' | 'blocked' | 'unknown';

export interface Blocker {
  id: string;
  category: BlockerCategory;
  title: string;
  description: string;
  /** Who unblocks this. */
  owner: 'ops' | 'legal' | 'audit_firm' | 'product' | 'bd' | 'platform';
  /** Order-of-magnitude time-to-unblock. */
  effort: 'hours' | 'days' | 'weeks' | 'months';
  /** When set, calling this returns whether the blocker is currently satisfied. */
  check?: () => BlockerStatus;
  /** Concrete next step text shown to operators. */
  nextStep: string;
  /** Doc anchor in launch-readiness.md. */
  docAnchor?: string;
}

function envSet(name: string): BlockerStatus {
  return process.env[name] && String(process.env[name]).trim().length > 0 ? 'ready' : 'blocked';
}

function anyEnvSet(...names: string[]): BlockerStatus {
  return names.every((n) => envSet(n) === 'ready') ? 'ready' : 'blocked';
}

export const BLOCKERS: Blocker[] = [
  // ── Operational — Solana ────────────────────────────────────────────
  {
    id: 'SOL-MULTISIG-01',
    category: 'operational',
    title: 'Squads multisig for Solana program authorities',
    description:
      'Transfer upgrade authority on Anchor programs (universe / episode / payment) and the $LOAR mint authority to a Squads v4 mainnet multisig.',
    owner: 'ops',
    effort: 'days',
    check: () => envSet('SQUADS_MAINNET_MULTISIG_PUBKEY'),
    nextStep:
      'Provision Squads v4 multisig, then run apps/programs/scripts/transfer-upgrade-authority.ts',
    docAnchor: 'O7',
  },
  {
    id: 'SOL-OPS-13',
    category: 'operational',
    title: 'Bridge reconciliation cron',
    description:
      'GitHub Actions cron at .github/workflows/bridge-reconcile.yml — needs BRIDGE_RECONCILE_URL and optional SLACK_WEBHOOK_URL.',
    owner: 'ops',
    effort: 'hours',
    check: () => envSet('BRIDGE_RECONCILE_URL'),
    nextStep: 'Set BRIDGE_RECONCILE_URL as a GitHub Actions secret on the repo.',
    docAnchor: 'O8',
  },
  {
    id: 'SOL-OPS-14',
    category: 'operational',
    title: 'Firestore TTL on bridgeIntents',
    description: 'Enable TTL on bridgeIntents.expiresAt so expired intents auto-purge.',
    owner: 'ops',
    effort: 'hours',
    nextStep: 'Firebase Console → Firestore → bridgeIntents → TTL policies → enable on `expiresAt`',
    docAnchor: 'O9',
  },
  {
    id: 'SOL-OPS-15',
    category: 'operational',
    title: 'Keypair backup pipeline',
    description:
      'Encrypted GPG backup of program keypairs after every mainnet anchor build via apps/programs/scripts/backup-keypairs.sh',
    owner: 'ops',
    effort: 'hours',
    nextStep: 'Designate GPG recipient identity, then run backup-keypairs.sh after each build.',
    docAnchor: 'O10',
  },
  {
    id: 'SOL-RUNBOOK-01',
    category: 'operational',
    title: 'Devnet runbook dry-run',
    description:
      'End-to-end devnet runbook + bridge round-trip with real $. Read-only dry-run executed 2026-05-15 (34 PASS).',
    owner: 'ops',
    effort: 'days',
    nextStep: 'Execute bridge round-trip with real $ on devnet before mainnet flip.',
    docAnchor: 'O11',
  },
  {
    id: 'SOL-BRIDGE-ENV',
    category: 'operational',
    title: 'Bridge env config (all-or-nothing)',
    description:
      'Bridge requires SOL_BRIDGE_VAULT_ATA + EVM_BRIDGE_VAULT_ADDRESS + CIRCLE_BRIDGE_SIGNER_ID_EVM + CIRCLE_BRIDGE_SIGNER_ID_SOL set together. Partial config = 503.',
    owner: 'ops',
    effort: 'hours',
    check: () =>
      anyEnvSet(
        'SOL_BRIDGE_VAULT_ATA',
        'EVM_BRIDGE_VAULT_ADDRESS',
        'CIRCLE_BRIDGE_SIGNER_ID_EVM',
        'CIRCLE_BRIDGE_SIGNER_ID_SOL'
      ),
    nextStep: 'Run apps/server/scripts/bridge-bootstrap.ts once Circle signer IDs are provisioned.',
    docAnchor: 'O12',
  },
  {
    id: 'HELIUS-WEBHOOK',
    category: 'operational',
    title: 'Helius webhook secret',
    description: 'HELIUS_WEBHOOK_SECRET on the indexer host for incoming Helius signed webhooks.',
    owner: 'ops',
    effort: 'hours',
    check: () => envSet('HELIUS_WEBHOOK_SECRET'),
    nextStep: 'Helius dashboard → webhook → signing secret → set HELIUS_WEBHOOK_SECRET on indexer.',
    docAnchor: 'O13',
  },

  // ── Operational — EVM cross-cutting ─────────────────────────────────
  {
    id: 'GOV-01',
    category: 'operational',
    title: 'Gnosis Safe (3/5) + Timelock',
    description:
      'Deploy Safe + TimelockController(48h), run TransferToMultisig on Base mainnet to move admin off deployer EOA.',
    owner: 'ops',
    effort: 'days',
    nextStep: 'Pick signers, fund deployer, run script/TransferToMultisig.s.sol on Base mainnet.',
    docAnchor: 'O2',
  },
  {
    id: 'TIMELOCK-01',
    category: 'operational',
    title: 'TimelockFactory wired into UniverseTokenDeployerV3',
    description:
      'TimelockFactory must be deployed and registered before the first mainnet universe mint.',
    owner: 'ops',
    effort: 'hours',
    nextStep: 'Run script/DeployTimelockFactory.s.sol (bundles setTimelockFactory authorization).',
    docAnchor: 'O3',
  },
  {
    id: 'INFRA-02',
    category: 'operational',
    title: 'SIWE JWT secret rotation + KMS',
    description: 'Rotate SIWE_JWT_SECRET and move to AWS KMS / GCP Secret Manager / Vault.',
    owner: 'ops',
    effort: 'days',
    check: () => envSet('SIWE_JWT_SECRET'),
    nextStep: 'Pick a KMS provider, rotate the secret, store in the managed vault.',
    docAnchor: 'O4',
  },
  {
    id: 'TOKEN-04',
    category: 'operational',
    title: 'Community treasury recipient',
    description:
      'Deploy DAO wallet or Merkle distributor, call setCommunityRecipient on $LOAR token.',
    owner: 'ops',
    effort: 'days',
    nextStep: 'Decide treasury address (DAO wallet or Merkle distributor), submit tx.',
    docAnchor: 'O5',
  },
  {
    id: 'DMCA-01',
    category: 'operational',
    title: 'DMCA putback enabled',
    description: 'Set DMCA_PUTBACK_ENABLED=true on exactly one prod replica.',
    owner: 'ops',
    effort: 'hours',
    check: () => envSet('DMCA_PUTBACK_ENABLED'),
    nextStep: 'Set DMCA_PUTBACK_ENABLED=true on Railway / Vercel for the prod replica.',
    docAnchor: 'O1',
  },

  // ── Legal ──────────────────────────────────────────────────────────
  {
    id: 'LEGAL-01',
    category: 'legal',
    title: 'Counsel review of /terms + /privacy',
    description:
      'External counsel review of substantive ToS + Privacy text live at /terms + /privacy.',
    owner: 'legal',
    effort: 'weeks',
    nextStep: 'Brief counsel; 2–4 wk turnaround typical.',
    docAnchor: 'X1',
  },
  {
    id: 'LEGAL-02',
    category: 'legal',
    title: 'Register DMCA agent',
    description:
      'Register designated DMCA agent with US Copyright Office (copyright.gov/dmca-directory).',
    owner: 'legal',
    effort: 'weeks',
    nextStep: 'Paralegal can file; ~1 wk, $6 fee.',
    docAnchor: 'X2',
  },
  {
    id: 'LEGAL-03',
    category: 'legal',
    title: '$LOAR ticker decision',
    description: 'NYSE:LOAR Holdings ticker collision — rename or accept C&D risk.',
    owner: 'legal',
    effort: 'days',
    nextStep: 'Product + legal alignment call.',
    docAnchor: 'X3',
  },
  {
    id: 'LIKENESS-POLICY',
    category: 'legal',
    title: 'Real-person consent policy',
    description: 'Creator attestation checkbox at universe creation + likeness policy page.',
    owner: 'legal',
    effort: 'weeks',
    nextStep: 'Draft policy with counsel.',
    docAnchor: 'X4',
  },

  // ── External — Audits + bug bounty ─────────────────────────────────
  {
    id: 'EVM-AUDIT-1',
    category: 'external',
    title: 'EVM external audit — Pass 1',
    description: 'Engage external audit firm on EVM contracts.',
    owner: 'audit_firm',
    effort: 'months',
    nextStep: 'Send outreach package from docs/external-audit-engagement.md to shortlisted firms.',
    docAnchor: 'X5',
  },
  {
    id: 'EVM-AUDIT-2',
    category: 'external',
    title: 'EVM external audit — Pass 2',
    description: 'Re-audit after Pass 1 fixes applied.',
    owner: 'audit_firm',
    effort: 'months',
    nextStep: 'Schedule after Pass 1 fixes land.',
    docAnchor: 'X6',
  },
  {
    id: 'SOL-AUDIT-01',
    category: 'external',
    title: 'Solana Anchor audit',
    description: 'External audit of Anchor programs (universe / episode / payment).',
    owner: 'audit_firm',
    effort: 'months',
    nextStep: 'Send Solana-specific outreach package from docs/external-audit-engagement.md.',
    docAnchor: 'X7',
  },
  {
    id: 'BUG-BOUNTY',
    category: 'external',
    title: 'Code4rena / Sherlock bug bounty',
    description: 'Public contest + ongoing bounty.',
    owner: 'audit_firm',
    effort: 'weeks',
    nextStep: '2-week setup on Code4rena or Sherlock.',
    docAnchor: 'X8',
  },
  {
    id: 'SOL-NTT-01',
    category: 'external',
    title: 'Wormhole NTT bridge migration',
    description:
      'Deploy NTT manager + transceiver on Solana + Sepolia/Base, retire custodial bridge.',
    owner: 'platform',
    effort: 'weeks',
    nextStep: 'Wormhole integration — coordinate with Wormhole devrel.',
    docAnchor: 'X13',
  },

  // ── Operational — non-blocking but recommended ─────────────────────
  {
    id: 'RELEASE-TAG',
    category: 'operational',
    title: 'Release tag v0.1.0-beta',
    description: 'Git tag before first public deploy.',
    owner: 'ops',
    effort: 'hours',
    nextStep: 'git tag -a v0.1.0-beta && git push --tags',
    docAnchor: 'O6',
  },
];

export interface ReadinessSnapshot {
  totalBlockers: number;
  readyCount: number;
  blockedCount: number;
  unknownCount: number;
  byCategory: Record<BlockerCategory, { ready: number; blocked: number; unknown: number }>;
  blockers: Array<Blocker & { status: BlockerStatus }>;
  generatedAt: Date;
}

export function snapshotReadiness(): ReadinessSnapshot {
  const evaluated = BLOCKERS.map((b) => ({
    ...b,
    status: b.check ? b.check() : ('unknown' as BlockerStatus),
  }));

  const byCategory: ReadinessSnapshot['byCategory'] = {
    operational: { ready: 0, blocked: 0, unknown: 0 },
    external: { ready: 0, blocked: 0, unknown: 0 },
    code: { ready: 0, blocked: 0, unknown: 0 },
    legal: { ready: 0, blocked: 0, unknown: 0 },
  };

  let readyCount = 0;
  let blockedCount = 0;
  let unknownCount = 0;

  for (const b of evaluated) {
    byCategory[b.category][b.status]++;
    if (b.status === 'ready') readyCount++;
    else if (b.status === 'blocked') blockedCount++;
    else unknownCount++;
  }

  return {
    totalBlockers: evaluated.length,
    readyCount,
    blockedCount,
    unknownCount,
    byCategory,
    blockers: evaluated,
    generatedAt: new Date(),
  };
}
