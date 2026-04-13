/**
 * AI Agent Credit Budget Service
 *
 * Manages isolated credit budgets for AI agents. Credits are transferred
 * from the human owner's balance to the agent's budget, then consumed
 * by pipeline steps.
 */
import { db } from '../lib/firebase';
import { TRPCError } from '@trpc/server';
import { FieldValue } from 'firebase-admin/firestore';

const userCreditsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('userCredits');
};

const aiAgentCreditsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('aiAgentCredits');
};

/**
 * Transfer credits from a human owner's balance to an AI agent's budget.
 * Atomic — both deduction and allocation happen in a single transaction.
 */
export async function allocateCreditsToAgent(
  ownerUid: string,
  agentId: string,
  amount: number
): Promise<{ ownerBalance: number; agentBalance: number }> {
  if (amount <= 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Amount must be positive' });
  }

  return db.runTransaction(async (tx) => {
    const ownerRef = userCreditsCol().doc(ownerUid);
    const agentRef = aiAgentCreditsCol().doc(agentId);

    const [ownerDoc, agentDoc] = await Promise.all([tx.get(ownerRef), tx.get(agentRef)]);

    const ownerBalance = ownerDoc.exists ? (ownerDoc.data()?.balance ?? 0) : 0;
    if (ownerBalance < amount) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Insufficient credits: have ${ownerBalance}, need ${amount}`,
      });
    }

    const agentBalance = agentDoc.exists ? (agentDoc.data()?.balance ?? 0) : 0;

    // Deduct from owner
    tx.update(ownerRef, {
      balance: ownerBalance - amount,
      totalSpent: (ownerDoc.data()?.totalSpent ?? 0) + amount,
      updatedAt: new Date(),
    });

    // Add to agent
    if (agentDoc.exists) {
      tx.update(agentRef, {
        balance: agentBalance + amount,
        totalAllocated: (agentDoc.data()?.totalAllocated ?? 0) + amount,
        updatedAt: new Date(),
      });
    } else {
      tx.set(agentRef, {
        balance: amount,
        totalSpent: 0,
        totalAllocated: amount,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return {
      ownerBalance: ownerBalance - amount,
      agentBalance: agentBalance + amount,
    };
  });
}

/**
 * Deduct credits from an AI agent's budget.
 * Atomic — fails if insufficient budget.
 */
export async function deductAgentCredits(agentId: string, amount: number): Promise<number> {
  if (amount <= 0) return 0;

  return db.runTransaction(async (tx) => {
    const ref = aiAgentCreditsCol().doc(agentId);
    const doc = await tx.get(ref);

    if (!doc.exists) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'AI agent has no credit budget' });
    }

    const balance = doc.data()?.balance ?? 0;
    if (balance < amount) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Agent budget insufficient: have ${balance}, need ${amount}`,
      });
    }

    tx.update(ref, {
      balance: balance - amount,
      totalSpent: (doc.data()?.totalSpent ?? 0) + amount,
      updatedAt: new Date(),
    });

    return balance - amount;
  });
}

/**
 * Refund credits to an AI agent's budget. Fire-and-forget.
 */
export async function refundAgentCredits(agentId: string, amount: number): Promise<void> {
  if (amount <= 0) return;

  try {
    const ref = aiAgentCreditsCol().doc(agentId);
    await ref.update({
      balance: FieldValue.increment(amount),
      updatedAt: new Date(),
    });
  } catch (err) {
    console.error(`Failed to refund ${amount} credits to agent ${agentId}:`, err);
  }
}

/**
 * Get an AI agent's credit balance and usage stats.
 */
export async function getAgentCreditStats(agentId: string): Promise<{
  balance: number;
  totalSpent: number;
  totalAllocated: number;
}> {
  const doc = await aiAgentCreditsCol().doc(agentId).get();
  if (!doc.exists) return { balance: 0, totalSpent: 0, totalAllocated: 0 };
  const data = doc.data()!;
  return {
    balance: data.balance ?? 0,
    totalSpent: data.totalSpent ?? 0,
    totalAllocated: data.totalAllocated ?? 0,
  };
}
