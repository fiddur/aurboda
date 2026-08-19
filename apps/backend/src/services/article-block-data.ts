/**
 * Data resolution behind an article chart/correlation block's rendered image —
 * the single source shared by the block-image routes (`createFeedImageRouter`
 * deps) and the markdown export's eligibility check (#974), so "would this
 * block's image render?" can never drift from what the endpoint actually does.
 */
import type { CorrelationSelector } from '@aurboda/api-spec'

import type { MetricType } from '../schema.ts'
import type { ScatterSvgData } from './charts/scatter-svg.ts'

import { getUserSettings } from '../db/index.ts'
import { getContinuousCorrelation } from './correlations/explore.ts'
import { queryMetricsBucketed } from './queries/index.ts'

/** The window-resolved inputs for one article correlation block's scatter. */
export interface CorrelationBlockParams {
  trigger: CorrelationSelector
  outcome: CorrelationSelector
  lagDays?: number
  /**
   * Inclusive day bounds (`YYYY-MM-DD`), sliced straight from the block's ISO
   * window (`iso.slice(0, 10)`) to match the web scatter's `toDay()`. Block windows
   * are `Z`-only (`iso8601DateTimeSchema` = `z.iso.datetime()`, offset false), so
   * this is the UTC day — but slicing the raw string rather than round-tripping
   * through `Date` keeps that parity exact and stays correct if the schema ever
   * gains offset support.
   */
  periodStart: string
  periodEnd: string
}

/**
 * An article chart block's bucketed metric series over its locked window
 * (mirrors the web's live bucketed render). Buckets in the author's own
 * timezone (`device_timezone`, IANA — auto-detected from their device) so a
 * `1d` bucket splits on the author's calendar days, matching the web render
 * (which sends the browser tz); falls back to UTC when it's unset.
 */
export const getArticleChartSeriesData = async (
  user: string,
  metric: MetricType,
  start: Date,
  end: Date,
  bucket: string,
): Promise<[Date, number][]> => {
  const settings = await getUserSettings(user)
  const result = await queryMetricsBucketed(user, [metric], start, end, bucket, {
    tz: settings?.device_timezone ?? undefined,
  })
  const series: [Date, number][] = []
  for (const b of result.buckets) {
    const avg = b.metrics[metric]?.avg
    if (avg != null) series.push([new Date(b.start), avg])
  }
  return series
}

/**
 * An article correlation block's continuous scatter over its locked window;
 * null when too sparse to be meaningful (n < 3), which 404s the image.
 */
export const getArticleCorrelationScatter = async (
  user: string,
  { lagDays, outcome, periodEnd, periodStart, trigger }: CorrelationBlockParams,
): Promise<ScatterSvgData | null> => {
  const c = await getContinuousCorrelation(user, {
    lagDays,
    outcome,
    periodEnd,
    periodStart,
    trigger,
  })
  if (c.n < 3) return null
  return {
    group_comparison: c.group_comparison,
    n: c.n,
    outcome,
    pearson: c.pearson,
    pearson_p: c.pearson_p,
    series: c.series,
    spearman: c.spearman,
    trigger,
  }
}
