/**
 * Tests for the `persona` tRPC router (PRD 9: Likeness Packages).
 *
 * NO MOCKS — uses the real Firestore emulator + real tRPC router. Covers:
 *   - create (self / parody / fictional) with origin-specific gates
 *   - parody routes to moderation queue
 *   - parody is blocked from being listed in the likeness marketplace
 *   - parody admin reviewApprove / Reject
 *   - update creates a new immutable version + bumps pointer
 *   - component ownership checks (voice / likeness)
 *
 * Prereq: firebase emulator running.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import './_real-firebase';
import {
  PERSONA_FICTIONAL_AFFIRMATION_V1,
  PERSONA_PARODY_ACKNOWLEDGEMENT_V1,
} from '../routers/entities/entities.types';

const CREATOR = '0x1111111111111111111111111111111111111111';
const ADMIN = '0xAdAdAdAdAdAdAdAdAdAdAdAdAdAdAdAdAdAdAdAd';
const OTHER = '0x2222222222222222222222222222222222222222';
const TEST_CLIENT_IP = '127.0.0.1';

async function createCaller(overrides?: { uid?: string; address?: string }) {
  const { router } = await import('../lib/trpc');
  const { personaRouter } = await import('../routers/persona/persona.routes');
  const { likenessMarketplaceRouter } =
    await import('../routers/likenessMarketplace/likenessMarketplace.routes');
  const appRouter = router({
    persona: personaRouter,
    likenessMarketplace: likenessMarketplaceRouter,
  });
  return appRouter.createCaller({
    user: {
      uid: overrides?.uid ?? 'test-uid-persona',
      address: overrides?.address ?? CREATOR,
      email: 'persona@test.com',
    },
    clientIp: TEST_CLIENT_IP,
  });
}

// Ensure the test admin address is allowlisted via env for adminProcedure.
beforeEach(() => {
  process.env.ADMIN_ADDRESSES = `${ADMIN.toLowerCase()},${CREATOR.toLowerCase()}`;
});

function basicProfile() {
  return {
    bio: 'Test bio for persona',
    systemPrompt: 'You are a test persona.',
    tone: {
      warmth: 60,
      formality: 40,
      humor: 70,
      confidence: 55,
      energy: 65,
    },
    exemplars: [{ userTurn: 'Hi', personaTurn: 'Hello there, friend.' }],
    tags: ['test'],
  };
}

async function createOwnedVoice(creator: string): Promise<string> {
  const { db } = await import('../lib/firebase');
  const id = `voice-${Math.random().toString(36).slice(2, 10)}`;
  await db
    .collection('entities')
    .doc(id)
    .set({
      id,
      name: 'Test Voice',
      description: '',
      kind: 'voice',
      universeAddress: null,
      parentId: null,
      nodeIds: [],
      imageUrl: null,
      metadata: { elevenLabsVoiceId: `el-${id}`, source: 'clone' },
      creator: creator.toLowerCase(),
      monetized: false,
      rightsDeclaration: null,
      unstoppableDomain: null,
      referenceBundle: null,
      visualDescriptor: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  return id;
}

describe('persona.create — origin gates', () => {
  it('creates a self-origin persona without moderation', async () => {
    const c = await createCaller();
    const result = await c.persona.create({
      name: 'Test Self Persona',
      description: '',
      origin: 'self',
      profile: basicProfile(),
    });
    expect(result.kind).toBe('persona');
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.origin).toBe('self');
    expect(meta.moderationStatus).toBe('not_required');
    expect(meta.versionCount).toBe(1);
    expect(meta.activeVersionId).toBeTruthy();
  });

  it('rejects fictional-origin without affirmation', async () => {
    const c = await createCaller();
    await expect(
      c.persona.create({
        name: 'Bad Fictional',
        description: '',
        origin: 'fictional',
        profile: basicProfile(),
      })
    ).rejects.toThrow(/affirm/);
  });

  it('creates a fictional-origin persona with affirmation', async () => {
    const c = await createCaller();
    const result = await c.persona.create({
      name: 'Test Fictional',
      description: '',
      origin: 'fictional',
      fictionalAffirmation: PERSONA_FICTIONAL_AFFIRMATION_V1,
      profile: basicProfile(),
    });
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.origin).toBe('fictional');
    expect(meta.moderationStatus).toBe('not_required');
    expect(meta.fictionalAffirmation).toBe(true);
  });

  it('routes parody-origin into moderation queue', async () => {
    const c = await createCaller();
    const result = await c.persona.create({
      name: 'Test Parody',
      description: '',
      origin: 'parody',
      parodySubject: 'Famous Person',
      parodyDisclaimer: 'This is parody — not endorsement.',
      parodyAcknowledgement: PERSONA_PARODY_ACKNOWLEDGEMENT_V1,
      profile: basicProfile(),
    });
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.origin).toBe('parody');
    expect(meta.moderationStatus).toBe('pending_review');
    expect(meta.parodySubject).toBe('Famous Person');

    // Moderation doc was created
    const { db } = await import('../lib/firebase');
    const modDoc = await db.collection('personaModeration').doc(result.id).get();
    expect(modDoc.exists).toBe(true);
    expect(modDoc.data()?.status).toBe('pending_review');
  });

  it('rejects parody without explicit subject + disclaimer', async () => {
    const c = await createCaller();
    await expect(
      c.persona.create({
        name: 'Bad Parody',
        description: '',
        origin: 'parody',
        parodyAcknowledgement: PERSONA_PARODY_ACKNOWLEDGEMENT_V1,
        profile: basicProfile(),
      })
    ).rejects.toThrow(/parodySubject/);
  });
});

describe('persona.create — component ownership', () => {
  it('accepts a voice component owned by the caller', async () => {
    const c = await createCaller();
    const voiceId = await createOwnedVoice(CREATOR);
    const result = await c.persona.create({
      name: 'Voice-Linked Persona',
      description: '',
      origin: 'self',
      voiceEntityId: voiceId,
      profile: basicProfile(),
    });
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.voiceEntityId).toBe(voiceId);
  });

  it('rejects a voice component owned by someone else', async () => {
    const c = await createCaller();
    const voiceId = await createOwnedVoice(OTHER);
    await expect(
      c.persona.create({
        name: 'Stolen-Voice Persona',
        description: '',
        origin: 'self',
        voiceEntityId: voiceId,
        profile: basicProfile(),
      })
    ).rejects.toThrow(/You do not own the referenced voice/);
  });

  it('rejects a wrong-kind component', async () => {
    const c = await createCaller();
    // Create a `likeness` entity but pass it as voiceEntityId
    const { db } = await import('../lib/firebase');
    const wrongId = `wrong-${Math.random().toString(36).slice(2)}`;
    await db.collection('entities').doc(wrongId).set({
      id: wrongId,
      name: 'A Likeness',
      description: '',
      kind: 'likeness',
      universeAddress: null,
      parentId: null,
      nodeIds: [],
      imageUrl: null,
      metadata: {},
      creator: CREATOR.toLowerCase(),
      monetized: false,
      rightsDeclaration: null,
      unstoppableDomain: null,
      referenceBundle: null,
      visualDescriptor: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      c.persona.create({
        name: 'Wrong-Kind Persona',
        description: '',
        origin: 'self',
        voiceEntityId: wrongId,
        profile: basicProfile(),
      })
    ).rejects.toThrow(/Expected voice to be kind=voice/);
  });
});

describe('persona.update — versioning', () => {
  it('creates a new immutable version on edit and bumps pointer', async () => {
    const c = await createCaller();
    const persona = await c.persona.create({
      name: 'Versioned Persona',
      description: '',
      origin: 'self',
      profile: basicProfile(),
    });

    const initial = persona.metadata as Record<string, unknown>;
    const v1Id = initial.activeVersionId as string;
    expect(v1Id).toBeTruthy();

    const updated = await c.persona.update({
      personaEntityId: persona.id,
      profile: { ...basicProfile(), bio: 'Updated bio' },
      changeNote: 'Tweaked bio',
    });
    expect(updated.version.version).toBe(2);
    expect(updated.metadata.versionCount).toBe(2);
    expect(updated.metadata.activeVersionId).not.toBe(v1Id);

    const versions = await c.persona.listVersions({ personaEntityId: persona.id });
    expect(versions.length).toBe(2);
    const active = versions.find((v: { active: boolean }) => v.active);
    expect(active).toBeDefined();
    expect(active?.version).toBe(2);
  });

  it('blocks edits while parody persona is pending review', async () => {
    const c = await createCaller();
    const persona = await c.persona.create({
      name: 'Locked Parody',
      description: '',
      origin: 'parody',
      parodySubject: 'Public Figure',
      parodyDisclaimer: 'Parody',
      parodyAcknowledgement: PERSONA_PARODY_ACKNOWLEDGEMENT_V1,
      profile: basicProfile(),
    });
    await expect(
      c.persona.update({
        personaEntityId: persona.id,
        profile: { ...basicProfile(), bio: 'Sneaky edit' },
      })
    ).rejects.toThrow(/moderation review/);
  });
});

describe('persona ↔ likenessMarketplace integration', () => {
  it('blocks listing a parody persona that is pending review', async () => {
    const adminCaller = await createCaller({ uid: 'admin', address: ADMIN });
    const c = await createCaller();
    const persona = await c.persona.create({
      name: 'Parody A',
      description: '',
      origin: 'parody',
      parodySubject: 'Famous Person',
      parodyDisclaimer: 'Parody',
      parodyAcknowledgement: PERSONA_PARODY_ACKNOWLEDGEMENT_V1,
      profile: basicProfile(),
    });

    // Even before consent, the readOwnedEntity gate should fire when we try.
    // We hit submitConsent first to surface the gate cleanly.
    await expect(
      c.likenessMarketplace.submitConsent({
        entityId: persona.id,
        modalities: ['full'],
        allowedUseCases: ['narrative_film'],
        permitSale: true,
        permitLease: false,
        permitLicense: false,
        realPerson: false,
        attestationText: (await import('../routers/entities/entities.types'))
          .LIKENESS_ATTESTATION_TEXT_V1,
      } as unknown as Parameters<typeof c.likenessMarketplace.submitConsent>[0])
    ).rejects.toThrow(/moderation review/);

    void adminCaller; // silence unused
  });

  it('lets a self-origin persona pass through the marketplace gate', async () => {
    const c = await createCaller();
    const persona = await c.persona.create({
      name: 'Self Persona',
      description: '',
      origin: 'self',
      profile: basicProfile(),
    });
    // submitConsent should succeed — we're not asserting full pricing here.
    const { LIKENESS_ATTESTATION_TEXT_V1 } = await import('../routers/entities/entities.types');
    await expect(
      c.likenessMarketplace.submitConsent({
        entityId: persona.id,
        modalities: ['full'],
        allowedUseCases: ['narrative_film'],
        permitSale: true,
        permitLease: false,
        permitLicense: false,
        realPerson: true,
        attestationText: LIKENESS_ATTESTATION_TEXT_V1,
      } as unknown as Parameters<typeof c.likenessMarketplace.submitConsent>[0])
    ).resolves.toBeTruthy();
  });
});

describe('persona.reviewParody — admin path', () => {
  it('admin approves a pending parody and unblocks listing', async () => {
    const owner = await createCaller();
    const persona = await owner.persona.create({
      name: 'Reviewable Parody',
      description: '',
      origin: 'parody',
      parodySubject: 'Public Figure',
      parodyDisclaimer: 'Parody',
      parodyAcknowledgement: PERSONA_PARODY_ACKNOWLEDGEMENT_V1,
      profile: basicProfile(),
    });
    const admin = await createCaller({ uid: 'admin-uid', address: ADMIN });

    const result = await admin.persona.reviewParody({
      personaEntityId: persona.id,
      decision: 'approved',
      notes: 'Clear parody, sufficient disclaimer.',
    });
    expect(result.status).toBe('approved');

    // Now the consent gate should pass.
    const { LIKENESS_ATTESTATION_TEXT_V1 } = await import('../routers/entities/entities.types');
    await expect(
      owner.likenessMarketplace.submitConsent({
        entityId: persona.id,
        modalities: ['full'],
        allowedUseCases: ['narrative_film'],
        permitSale: true,
        permitLease: false,
        permitLicense: false,
        realPerson: false,
        attestationText: LIKENESS_ATTESTATION_TEXT_V1,
      } as unknown as Parameters<typeof owner.likenessMarketplace.submitConsent>[0])
    ).resolves.toBeTruthy();
  });

  it('admin rejection keeps the persona blocked', async () => {
    const owner = await createCaller();
    const persona = await owner.persona.create({
      name: 'Rejected Parody',
      description: '',
      origin: 'parody',
      parodySubject: 'Public Figure',
      parodyDisclaimer: 'Parody',
      parodyAcknowledgement: PERSONA_PARODY_ACKNOWLEDGEMENT_V1,
      profile: basicProfile(),
    });
    const admin = await createCaller({ uid: 'admin-uid', address: ADMIN });
    const r = await admin.persona.reviewParody({
      personaEntityId: persona.id,
      decision: 'rejected',
      notes: 'Insufficient transformative intent',
    });
    expect(r.status).toBe('rejected');

    const { LIKENESS_ATTESTATION_TEXT_V1 } = await import('../routers/entities/entities.types');
    await expect(
      owner.likenessMarketplace.submitConsent({
        entityId: persona.id,
        modalities: ['full'],
        allowedUseCases: ['narrative_film'],
        permitSale: true,
        permitLease: false,
        permitLicense: false,
        realPerson: false,
        attestationText: LIKENESS_ATTESTATION_TEXT_V1,
      } as unknown as Parameters<typeof owner.likenessMarketplace.submitConsent>[0])
    ).rejects.toThrow(/rejected/);
  });

  it('rejects review of a non-pending persona', async () => {
    const owner = await createCaller();
    const persona = await owner.persona.create({
      name: 'Self Not Reviewable',
      description: '',
      origin: 'self',
      profile: basicProfile(),
    });
    const admin = await createCaller({ uid: 'admin-uid', address: ADMIN });
    await expect(
      admin.persona.reviewParody({
        personaEntityId: persona.id,
        decision: 'approved',
      })
    ).rejects.toThrow(/not origin=parody/);
  });
});

describe('persona.canList', () => {
  it('returns canList=false with reason=pending_parody_review for parody pending', async () => {
    const c = await createCaller();
    const persona = await c.persona.create({
      name: 'Pending',
      description: '',
      origin: 'parody',
      parodySubject: 'Public Figure',
      parodyDisclaimer: 'Parody',
      parodyAcknowledgement: PERSONA_PARODY_ACKNOWLEDGEMENT_V1,
      profile: basicProfile(),
    });
    const r = await c.persona.canList({ personaEntityId: persona.id });
    expect(r.canList).toBe(false);
    expect(r.reason).toBe('pending_parody_review');
  });

  it('returns canList=true for an approved self persona', async () => {
    const c = await createCaller();
    const persona = await c.persona.create({
      name: 'Self OK',
      description: '',
      origin: 'self',
      profile: basicProfile(),
    });
    const r = await c.persona.canList({ personaEntityId: persona.id });
    expect(r.canList).toBe(true);
  });
});

// Silence the unused TRPCError import for environments where re-exports
// are required for symbol resolution.
void TRPCError;
