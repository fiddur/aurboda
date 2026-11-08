import type { FeedVisibility, ShareDashboardPeriodBody } from '@aurboda/api-spec'

export interface DashboardShareForm {
  /** The shared dashboard; left out for the home dashboard. */
  dashboardId?: string
  period: string
  message: string
  visibility: FeedVisibility
  includeLink: boolean
  /** Whether the dashboard is published, the only case where a link can be included. */
  published: boolean
  /** Explicit tags; left out, the post gets the automatic ones. */
  tags?: string[]
}

export const buildDashboardShareBody = (form: DashboardShareForm): ShareDashboardPeriodBody => {
  const message = form.message.trim()
  return {
    ...(form.dashboardId === undefined ? {} : { dashboard_id: form.dashboardId }),
    include_link: form.includeLink && form.published,
    ...(message === '' ? {} : { message }),
    period: form.period,
    ...(form.tags === undefined ? {} : { tags: form.tags }),
    visibility: form.visibility,
  }
}

/** The preview's cache key: the body without `visibility`, which does not change what is posted. */
export const dashboardSharePreviewKey = ({
  visibility: _visibility,
  ...rest
}: ShareDashboardPeriodBody): string => JSON.stringify(rest)
