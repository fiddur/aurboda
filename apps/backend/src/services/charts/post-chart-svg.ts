/**
 * A feed post's chart as data, whichever kind it is, so the feed image routes and the post's
 * Open Graph card draw it from the same inputs with the same renderer per kind.
 */
import { articleImpactLabel, describeSelectorAxis } from '@aurboda/api-spec'

import { buildChartSvg, DEFAULT_CHART_LABEL } from './chart-svg.ts'
import { buildImpactSvg, type ImpactSvgData } from './impact-svg.ts'
import { buildRaceChartSvg, type RaceChartSvgData } from './race-chart-svg.ts'
import { buildScatterSvg, type ScatterSvgData } from './scatter-svg.ts'

/** Optional line styling; an article block or exercise trend labels its chart. */
export interface ChartRenderOpts {
  label?: string
  color?: string
}

export type PostChart =
  | { type: 'line'; series: [Date, number][]; opts?: ChartRenderOpts }
  | { type: 'race'; data: RaceChartSvgData }
  | { type: 'scatter'; data: ScatterSvgData }
  | { type: 'impact'; data: ImpactSvgData }

export interface PostChartSvgOptions {
  width: number
  height: number
  bare?: boolean
}

export const postChartSvg = (chart: PostChart, opts: PostChartSvgOptions): string => {
  switch (chart.type) {
    case 'line':
      return buildChartSvg(chart.series, { ...chart.opts, ...opts })
    case 'race':
      return buildRaceChartSvg(chart.data, opts)
    case 'scatter':
      return buildScatterSvg(chart.data, opts)
    case 'impact':
      return buildImpactSvg(chart.data, opts)
  }
}

/** What the chart shows, in words: the title its feed image draws, or for a race just "Standings". */
export const postChartCaption = (chart: PostChart): string => {
  switch (chart.type) {
    case 'line':
      return chart.opts?.label ?? DEFAULT_CHART_LABEL
    case 'race':
      return 'Standings'
    case 'scatter':
      return `${describeSelectorAxis(chart.data.trigger)} vs ${describeSelectorAxis(chart.data.outcome)}`
    case 'impact':
      return articleImpactLabel(chart.data)
  }
}

const MIN_LINE_POINTS = 2

/** Sessions in the window, and at least two buckets with any mean to join. */
export const isDrawableImpact = (data: Pick<ImpactSvgData, 'occurrences' | 'timeline'>): boolean =>
  data.occurrences > 0 &&
  data.timeline.filter((b) => b.hrv.mean != null || b.hr.mean != null || b.stress.mean != null).length >=
    MIN_LINE_POINTS

/** Whether a bare render would draw anything: a line needs two points, a race one line, a scatter one point, an impact two buckets with data. */
export const isDrawablePostChart = (chart: PostChart): boolean => {
  switch (chart.type) {
    case 'line':
      return chart.series.filter(([, v]) => Number.isFinite(v)).length >= MIN_LINE_POINTS
    case 'race':
      return chart.data.lines.some((line) => line.points.length >= MIN_LINE_POINTS)
    case 'scatter':
      return chart.data.series.length > 0
    case 'impact':
      return isDrawableImpact(chart.data)
  }
}
