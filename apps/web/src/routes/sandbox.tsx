/**
 * `/sandbox` — consolidated into `/create`.
 *
 * The generation workspace now lives at `/create` (the Higgsfield-style
 * console). This route redirects so old links / bookmarks keep working.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/sandbox')({
  beforeLoad: () => {
    throw redirect({ to: '/create' });
  },
});
