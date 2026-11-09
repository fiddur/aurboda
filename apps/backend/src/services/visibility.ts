/**
 * The one place that maps between the API/MCP `ShareVisibility` vocabulary and
 * the `is_public` boolean that shared dashboards and challenges store in the DB.
 *
 * Storage stays a boolean (no migration); the public surface (REST + MCP + web)
 * speaks `public`/`unlisted` consistently — the same words the feed uses. Both
 * routers and both MCP tools go through these two functions so the mapping lives
 * once. Feed posts have their own three-value `FeedVisibility` and don't use
 * this boolean bridge. Dashboards add `private` on top (`DashboardVisibility`),
 * stored as a second boolean, `is_private`, that wins over `is_public`.
 */
import type { DashboardVisibility, ShareVisibility } from '@aurboda/api-spec'

export const isPublicToVisibility = (isPublic: boolean): ShareVisibility => (isPublic ? 'public' : 'unlisted')

export const visibilityToIsPublic = (visibility: ShareVisibility): boolean => visibility === 'public'

export const dashboardVisibilityOf = (flags: {
  is_private: boolean
  is_public: boolean
}): DashboardVisibility => (flags.is_private ? 'private' : isPublicToVisibility(flags.is_public))

export const dashboardVisibilityToFlags = (
  visibility: DashboardVisibility,
): { is_private: boolean; is_public: boolean } =>
  visibility === 'private'
    ? { is_private: true, is_public: false }
    : { is_private: false, is_public: visibilityToIsPublic(visibility) }
