import type { DashboardWidget } from '@aurboda/api-spec'

import { goalsHref } from '../../components/goalPrefill'
import { buildChartUrl } from '../../utils/chart-url'
import { halfLifeOptions } from '../Chart/chartMeasures'

const SCORE_HALF_LIFE = Math.min(...halfLifeOptions('').map((o) => o.value))

export interface ScoreChartMenu {
  exploreHref: string
  goalHref: string
  sparkline: (title: string, id: string) => DashboardWidget
  widget: (title: string, id: string) => DashboardWidget
}

export const scoreChartMenu = (metric: string, days: number): ScoreChartMenu => {
  const trend = {
    aggregation: 'mean' as const,
    display_period: 'daily' as const,
    half_life_days: SCORE_HALF_LIFE,
    lookback_days: days,
    pattern: metric,
    source_type: 'metric' as const,
  }
  const titled = (title: string) => (title ? { title } : {})
  return {
    exploreHref: buildChartUrl({ ...trend, chart_type: 'trend' }),
    goalHref: goalsHref({
      aggregation: trend.aggregation,
      display_period: trend.display_period,
      half_life_days: trend.half_life_days,
      new: 'trend',
      pattern: metric,
      source_type: 'metric',
    }),
    sparkline: (title, id) => ({
      config: { lookback_days: days, metric, ...titled(title) },
      id,
      type: 'sparkline_card',
    }),
    widget: (title, id) => ({ config: { ...trend, ...titled(title) }, id, type: 'trend_chart' }),
  }
}
