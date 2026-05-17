/**
 * Talent Agent Types — Schemas and interfaces for the talent agent system
 */
import { z } from 'zod';

// ── Agent profile ──────────────────────────────────────────────────────

export const AGENT_SPECIALTIES = [
  'animation',
  'character-design',
  'world-building',
  'licensing',
  'voice-acting',
  'music',
  'writing',
  'directing',
  '3d-modeling',
  'vfx',
  'marketing',
  'brand-deals',
  'merch',
  'legal',
] as const;

export const talentAgentProfileSchema = z.object({
  agencyName: z.string().min(1).max(100),
  displayName: z.string().min(1).max(50),
  bio: z.string().max(1000).default(''),
  avatarUrl: z.string().url().optional(),
  website: z.string().url().optional(),
  socialLinks: z
    .object({
      twitter: z.string().url().optional(),
      linkedin: z.string().url().optional(),
      discord: z.string().optional(),
      telegram: z.string().optional(),
      farcaster: z.string().optional(),
    })
    .optional(),
  specialties: z.array(z.string()).max(10).default([]),
  visibility: z.enum(['public', 'private']).default('public'),
});

export type TalentAgentProfile = z.infer<typeof talentAgentProfileSchema> & {
  uid: string;
  verified: boolean;
  rating: number | null;
  totalDeals: number;
  totalRevenueGenerated: string;
  createdAt: Date;
  updatedAt: Date;
};

// ── Agent contract ─────────────────────────────────────────────────────

export const CONTRACT_SCOPES = [
  'licensing', // LicensingRegistry.sol (legacy)
  'contentLicensing', // ContentLicensing.sol (current)
  'collabs', // CollabManager.sol
  'marketplace', // CanonMarketplace.sol
  'merch', // generic merch / shop listings (catch-all)
  'bounties', // StoryBounties.sol
  'ads', // AdPlacement.sol
  'listings', // unified listings router
  'nft', // primary NFT mint + episode/character/edition mgmt
  'subscriptions', // SubscriptionManager.sol
] as const;
export type ContractScope = (typeof CONTRACT_SCOPES)[number];

export const contractStatusEnum = z.enum(['PROPOSED', 'ACTIVE', 'EXPIRED', 'TERMINATED']);
export type ContractStatus = z.infer<typeof contractStatusEnum>;

export const proposeContractSchema = z.object({
  targetUid: z.string().min(1), // the other party (creator or agent)
  commissionBps: z.number().min(0).max(3000), // max 30%
  exclusivity: z.enum(['EXCLUSIVE', 'NON_EXCLUSIVE']),
  scope: z.array(z.enum(CONTRACT_SCOPES)).min(1),
  durationDays: z.number().min(30).max(730), // 1 month to 2 years
  terms: z.string().min(10).max(5000),
  termsURI: z.string().url().optional(),
});

export interface AgentContractDoc {
  id: string;
  agentUid: string;
  creatorUid: string;
  status: ContractStatus;
  commissionBps: number;
  exclusivity: 'EXCLUSIVE' | 'NON_EXCLUSIVE';
  scope: string[];
  durationDays: number;
  startDate: Date | null;
  endDate: Date | null;
  proposedBy: 'agent' | 'creator';
  terms: string;
  termsURI: string | null;
  totalCommissionEarned: string;
  dealCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// ── Agent commission ───────────────────────────────────────────────────

export type CommissionSourceType =
  | 'license'
  | 'collab'
  | 'canon_license'
  | 'merch'
  | 'subscription';

export interface AgentCommissionDoc {
  id: string;
  agentContractId: string;
  agentUid: string;
  creatorUid: string;
  sourceType: CommissionSourceType;
  sourceId: string;
  grossAmountWei: string;
  commissionBps: number;
  commissionAmountWei: string;
  txHash: string | null;
  createdAt: Date;
}
