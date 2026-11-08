/**
 * Resolve what a dashboard-period share post holds (#1505) — shared by the REST
 * `POST /feed/dashboards` (and its preview) and the MCP `share_dashboard_period` /
 * `preview_dashboard_period_share` tools (parity). The post holds one finished period and a
 * sanitized snapshot of the dashboard's config, so a later edit of the dashboard never changes
 * what was shared. The link comes from the server: only for a published (unlisted or public)
 * shared dashboard whose author asked for it, never for the home dashboard.
 */
import type {
  DashboardConfig,
  DashboardShare,
  FeedStructuredDashboardShare,
  ShareDashboardPeriodBody,
} from '@aurboda/api-spec'

import { defaultDashboardConfig, periodGranularityOf } from '@aurboda/api-spec'

import { getSharedDashboardById, type SharedDashboardRecord } from '../db/index.ts'
import { renderDashboardShareHtml } from './activitypub/dashboard-object.ts'
import { hashtagLinks, linkifyHashtags } from './activitypub/hashtag-html.ts'
import { sanitizeConfig } from './dashboard-config.ts'
import { resolveStructuredDashboard } from './feed-structured-dashboard.ts'
import { normalizeFeedMessage } from './feed.ts'
import { isFinishedPeriod } from './periods.ts'
import { dashboardKindTag, type FeedTagSettings, resolvePostTags } from './post-tags.ts'
import { getSettings, getUserTimezone } from './settings.ts'
import { buildShareUrl } from './share-urls.ts'

export const HOME_DASHBOARD_NAME = 'Home'

export interface DashboardShareDeps {
  getSharedDashboardById: (
    user: string,
    id: string,
  ) => Promise<Pick<SharedDashboardRecord, 'config' | 'is_private' | 'name' | 'slug'> | null>
  getHomeDashboard: (user: string) => Promise<DashboardConfig>
  getUserTimezone: (user: string) => Promise<string>
  now: () => Date
}

const defaultDeps: DashboardShareDeps = {
  getHomeDashboard: async (user) => (await getSettings(user)).dashboard ?? defaultDashboardConfig,
  getSharedDashboardById: (user, id) => getSharedDashboardById(user, id),
  getUserTimezone,
  now: () => new Date(),
}

export type DashboardShareSource = Pick<ShareDashboardPeriodBody, 'dashboard_id' | 'include_link' | 'period'>

export type ResolvedDashboardShare =
  | { ok: true; dashboard: DashboardShare }
  | { ok: false; error: string; status: 400 | 404 }

interface ShareTarget {
  config: DashboardConfig
  name: string
  published: { slug: string } | null
}

const loadTarget = async (
  user: string,
  dashboardId: string | undefined,
  deps: DashboardShareDeps,
): Promise<ShareTarget | null> => {
  if (dashboardId === undefined) {
    return { config: await deps.getHomeDashboard(user), name: HOME_DASHBOARD_NAME, published: null }
  }
  const shared = await deps.getSharedDashboardById(user, dashboardId)
  if (!shared) return null
  return {
    config: shared.config,
    name: shared.name,
    published: shared.is_private ? null : { slug: shared.slug },
  }
}

export const resolveDashboardShare = async (
  user: string,
  body: DashboardShareSource,
  webHost: string | undefined,
  deps: DashboardShareDeps = defaultDeps,
): Promise<ResolvedDashboardShare> => {
  const target = await loadTarget(user, body.dashboard_id, deps)
  if (!target) return { error: 'Dashboard not found', ok: false, status: 404 }
  const { period } = target.config
  if (!period) return { error: 'Not a period dashboard', ok: false, status: 400 }
  const granularity = periodGranularityOf(body.period)
  if (granularity === null) return { error: 'Invalid period', ok: false, status: 400 }
  if (granularity !== period.granularity) {
    return { error: "period does not match the dashboard's granularity", ok: false, status: 400 }
  }
  const tz = await deps.getUserTimezone(user)
  if (!isFinishedPeriod(body.period, deps.now(), tz)) {
    return { error: 'The period is not finished yet', ok: false, status: 400 }
  }
  const url =
    target.published && body.include_link && webHost
      ? buildShareUrl(webHost, user, target.published.slug)
      : undefined
  return {
    dashboard: {
      config: sanitizeConfig(target.config),
      ...(body.dashboard_id === undefined ? {} : { dashboard_id: body.dashboard_id }),
      include_link: body.include_link,
      name: target.name,
      period: body.period,
      ...(url === undefined ? {} : { url }),
    },
    ok: true,
  }
}

/** The tags a dashboard post gets: the explicit ones, else the defaults and the dashboard's name; plus typed ones. */
export const dashboardShareTags = (
  user: string,
  dashboard: DashboardShare,
  body: Pick<ShareDashboardPeriodBody, 'message' | 'tags'>,
  loadSettings?: (user: string) => Promise<FeedTagSettings>,
): Promise<string[]> =>
  resolvePostTags(
    user,
    {
      explicit: body.tags,
      kindTag: dashboardKindTag(dashboard),
      texts: [normalizeFeedMessage(body.message)],
    },
    loadSettings,
  )

export type DashboardSharePreview =
  | { ok: true; content: string; structured?: FeedStructuredDashboardShare; tags: string[] }
  | { ok: false; error: string; status: 400 | 404 }

/** What sharing the period WOULD federate, creating nothing. */
export const previewDashboardShare = async (
  user: string,
  body: DashboardShareSource & Pick<ShareDashboardPeriodBody, 'message' | 'tags'>,
  webHost: string | undefined,
  deps: DashboardShareDeps = defaultDeps,
): Promise<DashboardSharePreview> => {
  const resolved = await resolveDashboardShare(user, body, webHost, deps)
  if (!resolved.ok) return resolved
  const message = normalizeFeedMessage(body.message) ?? null
  const [structured, tags] = await Promise.all([
    resolveStructuredDashboard(user, { dashboard: resolved.dashboard, kind: 'dashboard', message }),
    dashboardShareTags(user, resolved.dashboard, body),
  ])
  const content = linkifyHashtags(
    renderDashboardShareHtml(resolved.dashboard, structured, message),
    webHost ? hashtagLinks(webHost, user, tags) : undefined,
  )
  return { content, ok: true, tags, ...(structured == null ? {} : { structured }) }
}
