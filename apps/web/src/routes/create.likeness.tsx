/**
 * /create/likeness — Create a likeness entity + marketplace listing.
 * The flow itself lives in CreateLikenessFlow so My Listings can embed it too.
 */

import { createFileRoute } from '@tanstack/react-router';
import { CreateLikenessFlow } from '@/components/likeness-marketplace/CreateLikenessFlow';

export const Route = createFileRoute('/create/likeness')({
  component: () => <CreateLikenessFlow />,
});
