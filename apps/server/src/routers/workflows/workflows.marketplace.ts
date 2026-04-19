/**
 * PRD 9 Phase 2 — paid preset marketplace + canon-official publishing.
 *
 * Firestore collections:
 *   workflowLicenses — one doc per (workflowId, buyerUid) — gates paid runs
 *   workflowSales    — append-only ledger of every paid purchase (audit trail)
 *
 * Paid workflows: buyer pays `priceCredits`; platform takes PLATFORM_FEE_BPS,
 * the rest is credited to the owner's `userCredits` balance.
 *
 * Canon workflows: no credits exchanged, but the publisher must be a universe
 * admin (verified via isUniverseAdmin on the attached universeAddress).
 */
import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../lib/firebase';
import { isUniverseAdmin } from '../../lib/safe-admin';
import { assertGenerationAllowed } from '../../lib/generation-guards';
import { workflowsCol, getWorkflow } from './workflows.handlers';
import type { Workflow, WorkflowVisibility } from './workflows.types';

/** 15% platform fee on every paid workflow purchase (keeps 85% to creator). */
export const PLATFORM_FEE_BPS = 1500;
const BPS_DENOMINATOR = 10_000;

// ── Collections ────────────────────────────────────────────────────────

export function workflowLicensesCol() {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('workflowLicenses');
}

export function workflowSalesCol() {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('workflowSales');
}

// ── Licenses ───────────────────────────────────────────────────────────

export interface WorkflowLicense {
  id: string;
  workflowId: string;
  buyerUid: string;
  pricePaidCredits: number;
  saleId: string;
  createdAt: number;
}

export async function getLicense(
  workflowId: string,
  buyerUid: string
): Promise<WorkflowLicense | null> {
  const snap = await workflowLicensesCol()
    .where('workflowId', '==', workflowId)
    .where('buyerUid', '==', buyerUid)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].data() as WorkflowLicense;
}

export async function listLicensesForBuyer(
  buyerUid: string,
  limit = 100
): Promise<WorkflowLicense[]> {
  const snap = await workflowLicensesCol()
    .where('buyerUid', '==', buyerUid)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as WorkflowLicense);
}

// ── Publish rules (gate for updateWorkflow) ────────────────────────────

/**
 * Validate a visibility change before persisting. Called from updateWorkflow.
 * Throws on any rule violation.
 *
 *   paid  → priceCredits >= 1 required
 *   canon → universeAddress required, caller must be universe admin
 */
export async function assertPublishAllowed(args: {
  current: Workflow;
  nextVisibility?: WorkflowVisibility;
  nextPriceCredits?: number;
  nextUniverseAddress?: string | null;
  callerAddress: string | null;
}): Promise<void> {
  const visibility = args.nextVisibility ?? args.current.visibility;
  if (visibility === 'private' || visibility === 'collaborator') return;

  const priceCredits = args.nextPriceCredits ?? args.current.priceCredits;
  const universeAddress =
    args.nextUniverseAddress !== undefined
      ? args.nextUniverseAddress
      : args.current.universeAddress;

  if (visibility === 'paid') {
    if (!priceCredits || priceCredits < 1) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Paid workflows require priceCredits >= 1',
      });
    }
    if (args.current.graph.nodes.length === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot publish an empty workflow',
      });
    }
    return;
  }

  // canon
  if (!universeAddress) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Canon workflows require a universeAddress',
    });
  }
  if (!args.callerAddress) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Canon publishing requires a connected wallet',
    });
  }
  const ok = await isUniverseAdmin(universeAddress, args.callerAddress);
  if (!ok) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only universe admins can publish canon-official workflows',
    });
  }
  if (args.current.graph.nodes.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Cannot publish an empty workflow',
    });
  }
}

// ── Marketplace listing ────────────────────────────────────────────────

export interface MarketplaceEntry {
  workflow: Workflow;
  ownerUid: string;
  priceCredits: number;
  visibility: 'paid' | 'canon';
  universeAddress: string | null;
}

/**
 * List paid + canon workflows. Phase 2 query is simple — no ranking, no
 * curation. Filtered by content status = active.
 */
export async function listMarketplace(args: {
  visibility?: 'paid' | 'canon';
  universeAddress?: string | null;
  limit: number;
}): Promise<MarketplaceEntry[]> {
  const visibilities: Array<'paid' | 'canon'> = args.visibility
    ? [args.visibility]
    : ['paid', 'canon'];

  let q: FirebaseFirestore.Query = workflowsCol()
    .where('visibility', 'in', visibilities)
    .where('status', '==', 'active')
    .where('contentStatus', '==', 'active');
  if (args.universeAddress) {
    q = q.where('universeAddress', '==', args.universeAddress.toLowerCase());
  }
  const snap = await q.orderBy('updatedAt', 'desc').limit(args.limit).get();
  return snap.docs.map((d) => {
    const w = d.data() as Workflow;
    return {
      workflow: w,
      ownerUid: w.ownerUid,
      priceCredits: w.priceCredits,
      visibility: w.visibility as 'paid' | 'canon',
      universeAddress: w.universeAddress,
    };
  });
}

// ── Purchase ───────────────────────────────────────────────────────────

export interface WorkflowSale {
  id: string;
  workflowId: string;
  buyerUid: string;
  sellerUid: string;
  priceCredits: number;
  platformFeeCredits: number;
  sellerCredits: number;
  createdAt: number;
}

/**
 * Buy a paid workflow. Atomic in a single Firestore transaction:
 *  - deduct priceCredits from buyer
 *  - credit sellerCredits to owner (net of platform fee)
 *  - write sale ledger entry
 *  - write license doc so the buyer can run
 *
 * Free (canon) workflows don't need purchase — they're runnable by anyone in
 * the universe. This function rejects canon input.
 */
export async function purchaseWorkflow(args: {
  workflowId: string;
  buyerUid: string;
}): Promise<{ saleId: string; licenseId: string }> {
  const workflow = await getWorkflow(args.workflowId);
  if (!workflow) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' });
  if (workflow.visibility !== 'paid') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Workflow visibility is ${workflow.visibility}, not paid — no purchase needed`,
    });
  }
  if (workflow.contentStatus !== 'active') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Workflow is ${workflow.contentStatus}`,
    });
  }
  if (workflow.ownerUid === args.buyerUid) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'You already own this workflow' });
  }

  // Short-circuit if already owned
  const existing = await getLicense(args.workflowId, args.buyerUid);
  if (existing) {
    return { saleId: existing.saleId, licenseId: existing.id };
  }

  if (!db) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  }

  const price = workflow.priceCredits;
  await assertGenerationAllowed(args.buyerUid, price);

  const platformFee = Math.floor((price * PLATFORM_FEE_BPS) / BPS_DENOMINATOR);
  const sellerCredits = price - platformFee;

  const saleId = randomUUID();
  const licenseId = randomUUID();
  const now = Date.now();

  const buyerRef = db.collection('userCredits').doc(args.buyerUid);
  const sellerRef = db.collection('userCredits').doc(workflow.ownerUid);
  const saleRef = workflowSalesCol().doc(saleId);
  const licenseRef = workflowLicensesCol().doc(licenseId);
  const buyerTxRef = db.collection('creditTransactions').doc();
  const sellerTxRef = db.collection('creditTransactions').doc();

  await db.runTransaction(async (tx) => {
    const buyerDoc = await tx.get(buyerRef);
    const balance = (buyerDoc.data()?.balance as number) || 0;
    if (balance < price) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Insufficient credits. Need ${price}, have ${balance}.`,
      });
    }

    // Debit buyer
    tx.update(buyerRef, {
      balance: balance - price,
      totalSpent: ((buyerDoc.data()?.totalSpent as number) || 0) + price,
      updatedAt: new Date(),
    });
    tx.set(buyerTxRef, {
      uid: args.buyerUid,
      type: 'spend',
      generationType: 'workflow_purchase',
      credits: -price,
      source: 'workflow_marketplace',
      workflowId: args.workflowId,
      saleId,
      createdAt: new Date(),
    });

    // Credit seller
    tx.set(
      sellerRef,
      {
        balance: FieldValue.increment(sellerCredits),
        totalEarned: FieldValue.increment(sellerCredits),
        updatedAt: new Date(),
      },
      { merge: true }
    );
    tx.set(sellerTxRef, {
      uid: workflow.ownerUid,
      type: 'earn',
      generationType: 'workflow_sale',
      credits: sellerCredits,
      source: 'workflow_marketplace',
      workflowId: args.workflowId,
      saleId,
      createdAt: new Date(),
    });

    // Sale ledger
    const sale: WorkflowSale = {
      id: saleId,
      workflowId: args.workflowId,
      buyerUid: args.buyerUid,
      sellerUid: workflow.ownerUid,
      priceCredits: price,
      platformFeeCredits: platformFee,
      sellerCredits,
      createdAt: now,
    };
    tx.set(saleRef, sale);

    // License (gates runs)
    const license: WorkflowLicense = {
      id: licenseId,
      workflowId: args.workflowId,
      buyerUid: args.buyerUid,
      pricePaidCredits: price,
      saleId,
      createdAt: now,
    };
    tx.set(licenseRef, license);
  });

  return { saleId, licenseId };
}

// ── Run-time visibility gate (called by assertWorkflowRunnable) ────────

/**
 * For paid workflows, the runner must hold a license OR be the owner.
 * For canon workflows, any wallet connected to the universe can run (Phase 2
 * keeps this simple — universe-gated view, open run).
 * Throws TRPCError when the runner is not entitled.
 */
export async function assertMarketplaceRunAllowed(
  workflow: Workflow,
  runnerUid: string
): Promise<void> {
  if (workflow.visibility === 'paid') {
    if (workflow.ownerUid === runnerUid) return;
    const license = await getLicense(workflow.id, runnerUid);
    if (!license) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Purchase required to run this workflow',
      });
    }
    return;
  }
  // canon — no per-user gate in Phase 2; universe authors can tighten in Phase 3
}
