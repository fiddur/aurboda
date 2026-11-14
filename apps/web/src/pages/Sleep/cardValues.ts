import type { PeriodMetricStats } from '@aurboda/api-spec'

import { periodStatsValue } from '../../state/api/periodSummary'

export interface SleepCardValue {
  avg: number | null
  trend: number | null
}

export const sleepCardValues = (metrics: PeriodMetricStats[]): Record<string, SleepCardValue> =>
  Object.fromEntries(
    metrics.map((m) => {
      const avg = periodStatsValue(m, 'avg')
      return [m.metric, { avg, trend: avg === null ? null : m.change_from_previous_period_percent }]
    }),
  )
