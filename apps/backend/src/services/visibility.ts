/**
 * The one place that maps between the API/MCP `ShareVisibility` vocabulary and
 * the `is_public` boolean that shared dashboards and challenges store in the DB.
 *
 * Storage stays a boolean (no migration); the public surface (REST + MCP + web)
 * speaks `public`/`unlisted` consistently — the same words the feed uses. Both
 * routers and both MCP tools go through these two functions so the mapping lives
 * once. Feed posts have their own three-value `FeedVisibility` and don't use
 * this boolean bridge.
 */
import type { ShareVisibility } from '@aurboda/api-spec'

/** Map the stored `is_public` boolean to the public `ShareVisibility` vocabulary. */
export const isPublicToVisibility = (isPublic: boolean): ShareVisibility => (isPublic ? 'public' : 'unlisted')

/** Map a `ShareVisibility` back to the stored `is_public` boolean. */
export const visibilityToIsPublic = (visibility: ShareVisibility): boolean => visibility === 'public'
