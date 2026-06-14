/**
 * Filmmaker Residency Router
 *
 * Curated creator program — applicants submit a statement + sample work,
 * admins review, accepted residents form the active cohort. Surfaces public
 * cohort showcase + private application review queue.
 *
 * Out of scope for v1 (deferred to Phase 5.5): on-chain stipends via $LOAR
 * staking, festival pipeline coordination, mentor matching.
 */

import { router, protectedProcedure, publicProcedure, adminProcedure } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';

const residencyApplicationsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('residencyApplications');
};

const applySchema = z.object({
  name: z.string().min(1).max(120),
  portfolioUrl: z.string().url(),
  statement: z.string().min(50).max(2000),
  sampleWorkUrls: z.array(z.string().url()).min(1).max(8),
  cohort: z.string().max(40).default('default'),
});

const reviewSchema = z.object({
  id: z.string(),
  status: z.enum(['accepted', 'rejected']),
  reviewerNote: z.string().max(500).optional(),
});

export interface ResidencyApplication {
  id: string;
  applicantUid: string;
  applicantAddress?: string;
  name: string;
  portfolioUrl: string;
  statement: string;
  sampleWorkUrls: string[];
  cohort: string;
  status: 'pending' | 'accepted' | 'rejected';
  reviewerUid?: string;
  reviewerNote?: string;
  submittedAt: Date;
  reviewedAt?: Date;
}

export const residenciesRouter = router({
  submit: protectedProcedure.input(applySchema).mutation(async ({ input, ctx }) => {
    // One pending application per (user, cohort).
    // No composite index on residencyApplications — bound by applicantUid only
    // (small per-user set), then filter cohort + status in memory.
    const existingSnap = await residencyApplicationsCol()
      .where('applicantUid', '==', ctx.user.uid)
      .get();
    const hasPending = existingSnap.docs
      .map((d) => d.data() as ResidencyApplication)
      .some((a) => a.cohort === input.cohort && a.status === 'pending');
    if (hasPending) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'You already have a pending application for this cohort',
      });
    }

    const id = randomUUID();
    const doc: ResidencyApplication = {
      id,
      applicantUid: ctx.user.uid,
      applicantAddress: ctx.user.address,
      name: input.name,
      portfolioUrl: input.portfolioUrl,
      statement: input.statement,
      sampleWorkUrls: input.sampleWorkUrls,
      cohort: input.cohort,
      status: 'pending',
      submittedAt: new Date(),
    };
    const clean = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));
    await residencyApplicationsCol().doc(id).set(clean);
    return doc;
  }),

  /** Public — list accepted residents in a cohort (the showcase). */
  cohort: publicProcedure
    .input(z.object({ cohort: z.string().default('default') }))
    .query(async ({ input }) => {
      // No composite index — bound by cohort only, filter status + sort in memory.
      const snap = await residencyApplicationsCol().where('cohort', '==', input.cohort).get();
      const accepted = snap.docs
        .map((d) => d.data() as ResidencyApplication)
        .filter((a) => a.status === 'accepted')
        .sort(
          (a, b) => new Date(b.reviewedAt ?? 0).getTime() - new Date(a.reviewedAt ?? 0).getTime()
        )
        .slice(0, 100);
      // Strip statement + reviewerNote from public payload — privacy.
      return accepted.map(({ statement, reviewerNote, reviewerUid, ...rest }) => rest);
    }),

  /** Applicant view — see your own application(s). */
  mine: protectedProcedure.query(async ({ ctx }) => {
    // No composite index — bound by applicantUid only, sort submittedAt in memory.
    const snap = await residencyApplicationsCol().where('applicantUid', '==', ctx.user.uid).get();
    return snap.docs
      .map((d) => d.data() as ResidencyApplication)
      .sort(
        (a, b) => new Date(b.submittedAt ?? 0).getTime() - new Date(a.submittedAt ?? 0).getTime()
      )
      .slice(0, 50);
  }),

  /** Admin — list applications (optionally filter by status / cohort). */
  listApplications: adminProcedure
    .input(
      z.object({
        status: z.enum(['pending', 'accepted', 'rejected']).optional(),
        cohort: z.string().optional(),
        limit: z.number().min(1).max(200).default(100),
      })
    )
    .query(async ({ input }) => {
      // No composite index — keep ONE bounding equality filter in Firestore
      // (prefer status, else cohort, else none), filter the rest + sort in memory.
      let query = residencyApplicationsCol() as FirebaseFirestore.Query;
      if (input.status) query = query.where('status', '==', input.status);
      else if (input.cohort) query = query.where('cohort', '==', input.cohort);
      const snap = await query.get();
      // cohort only needs in-memory filtering when status was the Firestore filter.
      const filterCohortInMemory = Boolean(input.status && input.cohort);
      return snap.docs
        .map((d) => d.data() as ResidencyApplication)
        .filter((a) => (filterCohortInMemory ? a.cohort === input.cohort : true))
        .sort(
          (a, b) => new Date(b.submittedAt ?? 0).getTime() - new Date(a.submittedAt ?? 0).getTime()
        )
        .slice(0, input.limit);
    }),

  /** Admin — accept or reject an application. */
  review: adminProcedure.input(reviewSchema).mutation(async ({ input, ctx }) => {
    const ref = residencyApplicationsCol().doc(input.id);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Application not found' });
    }
    const data = snap.data() as ResidencyApplication;
    if (data.status !== 'pending') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Application already ${data.status}`,
      });
    }
    await ref.update({
      status: input.status,
      reviewerUid: ctx.user.uid,
      reviewerNote: input.reviewerNote ?? null,
      reviewedAt: new Date(),
    });
    return { ok: true };
  }),
});
