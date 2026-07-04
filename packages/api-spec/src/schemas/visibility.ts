/**
 * Shared "share visibility" vocabulary.
 *
 * A single source of truth for how any shareable thing (feed posts, shared
 * dashboards, hosted challenges) describes its audience, so the API, MCP tools,
 * and web UI all speak the same words:
 *
 * - `public`   — listed on your public profile and public timelines.
 * - `unlisted` — reachable only by its link; kept off profile/timeline listings.
 *
 * The feed extends this with a third audience (`followers`) — see
 * `feedVisibilitySchema`, which is built from `shareVisibilityValues`.
 *
 * Dashboards and challenges store this as an `is_public` boolean column; the
 * REST/MCP layers map that boolean to/from this vocabulary at the boundary (see
 * the backend `services/visibility.ts`), so storage stays a boolean while the
 * public surface is consistent.
 */
import { z } from 'zod'

/** The base audiences every shareable thing supports, in a fixed order. */
export const shareVisibilityValues = ['public', 'unlisted'] as const

export const shareVisibilitySchema = z.enum(shareVisibilityValues).meta({
  description:
    'Who can see a shared item: `public` (listed on your public profile) or `unlisted` (reachable only by its link).',
  id: 'ShareVisibility',
})

export type ShareVisibility = z.infer<typeof shareVisibilitySchema>
