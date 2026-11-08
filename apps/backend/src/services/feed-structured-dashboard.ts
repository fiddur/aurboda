/**
 * The structured payload of a dashboard-period share post (#1505): the shared dashboard's widgets
 * resolved for the shared period from the config snapshot stored at share time, so a later edit of
 * the dashboard never changes the post and nothing beyond the shared widgets leaves the instance.
 */
import type { DashboardConfig, FeedStructuredDashboardShare, WidgetDataMap } from '@aurboda/api-spec'

import type { FeedPostRecord } from '../db/index.ts'

import { periodWindow, type PeriodWindowBounds, previousWindow } from './periods.ts'
import { getUserTimezone } from './settings.ts'
import { resolveDashboardData } from './shared-dashboard-data.ts'

export interface StructuredDashboardDeps {
  getUserTimezone: (user: string) => Promise<string>
  resolveDashboardData: (
    user: string,
    config: DashboardConfig,
    options: { previous: PeriodWindowBounds; window: PeriodWindowBounds },
  ) => Promise<WidgetDataMap>
}

const defaultDeps: StructuredDashboardDeps = {
  getUserTimezone,
  resolveDashboardData: (user, config, options) => resolveDashboardData(user, config, options),
}

export type StructuredDashboardPost = Pick<FeedPostRecord, 'dashboard' | 'kind' | 'message'>

/** Null when the post is not a dashboard post. */
export const resolveStructuredDashboard = async (
  user: string,
  post: StructuredDashboardPost,
  deps: StructuredDashboardDeps = defaultDeps,
): Promise<FeedStructuredDashboardShare | null> => {
  if (post.kind !== 'dashboard' || post.dashboard == null) return null
  const dashboard = post.dashboard
  const tz = await deps.getUserTimezone(user)
  const window = periodWindow(dashboard.period, tz)
  const widget_data = await deps.resolveDashboardData(user, dashboard.config, {
    previous: previousWindow(dashboard.period, tz),
    window,
  })
  return {
    config: dashboard.config,
    kind: 'dashboard',
    name: dashboard.name,
    period: dashboard.period,
    widget_data,
    window: { end: window.end.toISOString(), start: window.start.toISOString() },
    ...(post.message != null ? { message: post.message } : {}),
    ...(dashboard.url != null ? { url: dashboard.url } : {}),
  }
}
