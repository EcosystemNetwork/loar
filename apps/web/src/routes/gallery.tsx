/**
 * Legacy /gallery route — now redirects into the Wiki's Gallery tab.
 * Kept so existing links (discover, search, edit.inpaint, external) don't 404.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

const gallerySearchSchema = z.object({
  universe: z.string().optional(),
  contentId: z.string().optional(),
});

export const Route = createFileRoute('/gallery')({
  validateSearch: gallerySearchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/wiki',
      search: {
        tab: 'gallery',
        ...(search.universe ? { universe: search.universe } : {}),
      },
    });
  },
});
