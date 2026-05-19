/**
 * Mainnet Readiness Router — surfaces the launch blocker scorecard to the
 * admin dashboard.
 *
 * Single endpoint, admin-gated, returns a live snapshot of every blocker
 * tracked in docs/launch-readiness.md with auto-detected status where
 * possible (env vars, etc.) and operator next-steps for the rest.
 */

import { router, adminProcedure } from '../../lib/trpc';
import { snapshotReadiness } from '../../services/mainnet-readiness/blockers';

export const mainnetReadinessRouter = router({
  snapshot: adminProcedure.query(() => snapshotReadiness()),
});
