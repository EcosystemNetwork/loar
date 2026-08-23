/**
 * Offchain ENS subname registry for LOAR AI agents.
 *
 * Each LOAR agent can claim a gasless subname under a parent the platform
 * controls (e.g. `<label>.agents.loar.eth`). The names live in Firestore and
 * are served to ENS clients via the CCIP-Read gateway (see routes/ens.ts +
 * LoarAgentResolver.sol) — so a whole agent fleet gets verifiable ENS
 * identities with ENSIP-26 agent endpoints, without an on-chain tx per name.
 *
 * Firestore collection: `ensAgentSubnames`, doc id = lowercased label.
 */
import { db, firebaseAvailable } from './firebase';

/** Parent name the subnames live under. Override per deployment. */
export function agentParentName(): string {
  return (process.env.ENS_AGENT_PARENT || 'agents.loar.eth').toLowerCase();
}

export interface AgentSubname {
  /** Leftmost label, e.g. "showrunner" in showrunner.agents.loar.eth. */
  label: string;
  /** Full name for display. */
  name: string;
  /** Address the name resolves to (the agent owner's Circle wallet). */
  address: string;
  /** ENSIP-26 + display text records served for this name. */
  texts: Record<string, string>;
  /** LOAR agent this name belongs to. */
  aiAgentId: string;
  ownerUid: string;
  createdAt: Date;
  updatedAt: Date;
}

const LABEL_RE = /^[a-z0-9-]{1,63}$/;

export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

export function isValidLabel(label: string): boolean {
  return LABEL_RE.test(label) && !label.startsWith('-') && !label.endsWith('-');
}

const col = () => (firebaseAvailable ? db.collection('ensAgentSubnames') : null);
const mem = new Map<string, AgentSubname>();

/**
 * Claim/update an agent subname. Idempotent per (label): re-registering the
 * same label by the same owner updates its records; a different owner is
 * rejected so labels can't be hijacked.
 */
export async function registerAgentSubname(input: {
  label: string;
  address: string;
  aiAgentId: string;
  ownerUid: string;
  texts?: Record<string, string>;
}): Promise<AgentSubname> {
  const label = normalizeLabel(input.label);
  if (!isValidLabel(label)) {
    throw new Error('Label must be 1–63 chars of a–z, 0–9, hyphen (not leading/trailing).');
  }

  const existing = await getAgentSubname(label);
  if (existing && existing.ownerUid.toLowerCase() !== input.ownerUid.toLowerCase()) {
    throw new Error(`Subname "${label}" is already claimed.`);
  }

  const now = new Date();
  const record: AgentSubname = {
    label,
    name: `${label}.${agentParentName()}`,
    address: input.address,
    aiAgentId: input.aiAgentId,
    ownerUid: input.ownerUid,
    texts: {
      ...(input.texts ?? {}),
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const c = col();
  if (c) {
    await c.doc(label).set(record, { merge: true });
  } else {
    mem.set(label, record);
  }
  return record;
}

async function getAgentSubname(label: string): Promise<AgentSubname | null> {
  const l = normalizeLabel(label);
  const c = col();
  if (c) {
    const doc = await c.doc(l).get();
    return doc.exists ? (doc.data() as AgentSubname) : null;
  }
  return mem.get(l) ?? null;
}

export async function listAgentSubnamesByOwner(ownerUid: string): Promise<AgentSubname[]> {
  const c = col();
  if (c) {
    const snap = await c.where('ownerUid', '==', ownerUid.toLowerCase()).limit(100).get();
    return snap.docs.map((d) => d.data() as AgentSubname);
  }
  return [...mem.values()].filter((s) => s.ownerUid.toLowerCase() === ownerUid.toLowerCase());
}

/**
 * Resolve a full ENS name to its subname record, if it lives under our parent.
 * Returns null for names we don't manage.
 */
export async function resolveManagedName(name: string): Promise<AgentSubname | null> {
  const lower = name.toLowerCase().replace(/\.$/, '');
  const suffix = `.${agentParentName()}`;
  if (!lower.endsWith(suffix)) return null;
  const label = lower.slice(0, -suffix.length);
  if (label.includes('.')) return null; // only direct children
  return getAgentSubname(label);
}
