/**
 * vlm.* — Vision-Language Model subsystem router aggregator.
 * See docs/prd-vlm-subsystem.md for the full spec.
 */

import { router } from '../../lib/trpc';
import { vlmExtractRouter } from './vlm.extract.routes';
import { vlmProposalsRouter } from './vlm.proposals.routes';
import { vlmCanonRouter } from './vlm.canon.routes';
import { vlmSearchRouter } from './vlm.search.routes';
import { vlmModerationRouter } from './vlm.moderation.routes';
import { vlmCopilotRouter } from './vlm.copilot.routes';
import { vlmRecapRouter } from './vlm.recap.routes';
import { vlmGovernanceRouter } from './vlm.governance.routes';

export const vlmRouter = router({
  extract: vlmExtractRouter,
  proposals: vlmProposalsRouter,
  canon: vlmCanonRouter,
  search: vlmSearchRouter,
  moderation: vlmModerationRouter,
  copilot: vlmCopilotRouter,
  recap: vlmRecapRouter,
  governance: vlmGovernanceRouter,
});
