/**
 * Re-exports the AppRouter type from the server.
 *
 * This is the ONLY place that bridges server types into the frontend.
 * apps/web imports from @loar/shared/trpc — never directly from apps/server.
 *
 * This is a type-only module: it emits zero runtime code.
 */
export type { AppRouter } from '../../../apps/server/src/routers';
