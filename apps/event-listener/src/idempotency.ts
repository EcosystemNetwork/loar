import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { COLLECTIONS, type EventEnvelope } from './schema.js';

export interface AggregateEventClaim {
  id: string;
  eventId: string;
  scope: string;
  _event: EventEnvelope;
}

export async function runClaimedAggregateMutation(
  firestore: Firestore,
  scope: string,
  envelope: EventEnvelope,
  mutate: (tx: Transaction) => Promise<boolean>
): Promise<boolean> {
  const eventId = `${envelope.txHash}:${envelope.logIndex}`;
  const claimRef = firestore
    .collection(COLLECTIONS.aggregateEventClaims)
    .doc(`${envelope.chainId}:${eventId}:${scope}`);

  return firestore.runTransaction(async (tx) => {
    if ((await tx.get(claimRef)).exists) return false;
    if (!(await mutate(tx))) return false;

    const claim: AggregateEventClaim = {
      id: claimRef.id,
      eventId,
      scope,
      _event: envelope,
    };
    tx.create(claimRef, claim);
    return true;
  });
}
