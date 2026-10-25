import type {
  GoalDayStatus,
  GoalHistoryBucket,
  GoalHistoryQuery,
  GoalHistorySummary,
} from '@aurboda/api-spec'

import { statusLabel } from './charts/goal-history-chart-utils'

export const goalHistoryRanges = ['30d', '90d', '1y'] as const

export type GoalHistoryRange = (typeof goalHistoryRanges)[number]

export const goalHistoryRangeLabels: Record<GoalHistoryRange, string> = {
  '1y': '1 year',
  '30d': '30 days',
  '90d': '90 days',
}

const rangeQueries: Record<GoalHistoryRange, GoalHistoryQuery> = {
  '1y': { bucket: 'month', lookback_days: 365 },
  '30d': { bucket: 'day', lookback_days: 30 },
  '90d': { bucket: 'day', lookback_days: 90 },
}

export const rangeToQuery = (range: GoalHistoryRange): GoalHistoryQuery => rangeQueries[range]

export const parseRange = (s?: string): GoalHistoryRange => goalHistoryRanges.find((r) => r === s) ?? '30d'

export const summaryText = (
  summary: GoalHistorySummary,
  bucket: GoalHistoryBucket,
  todayStatus?: GoalDayStatus,
): string => {
  const parts = [
    `On target ${summary.days_met} of ${summary.days_total} day${summary.days_total === 1 ? '' : 's'}`,
  ]
  if (summary.days_over > 0) parts.push(`${summary.days_over} over`)
  if (bucket === 'day' && todayStatus) parts.push(`today so far: ${statusLabel(todayStatus)}`)
  return parts.join(' · ')
}

export const goalsUrl = ({
  embed,
  history,
  range,
}: {
  embed?: boolean
  history?: string
  range: GoalHistoryRange
}): string => {
  const params = new URLSearchParams()
  if (history) params.set('history', history)
  params.set('range', range)
  if (embed) params.set('embed', '1')
  return `/goals?${params.toString()}`
}
