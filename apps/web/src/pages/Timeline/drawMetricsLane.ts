import type { ScreentimeCategory, TrainingLoadResult } from '@aurboda/api-spec'
import type * as d3 from 'd3'

import type { ScreentimeBucketParsed } from '../../state/api'
import type { LegendCategory } from './legendCategories'

import { BAR_BUCKET_NOMINAL_MS, type BarBucketSize } from '../../utils/barWindows'
import { aggregateBucketsAligned, type MetricBucketParsed } from '../../utils/chart'
import { computeBarLayout } from './barLayout'
import {
  computeYScales,
  drawMetricsTrack,
  LINE_CHUNK_ALIGNMENT,
  type MetricsYScales,
} from './drawMetricsTrack'
import { drawScreentimeBars } from './drawScreentimeTrack'
import { drawTrainingLoadTrack } from './drawTrainingLoadTrack'
import { visibleBuckets } from './visibleBuckets'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SvgGroup = d3.Selection<any, unknown, null, undefined>

type TrainingLoadData = Pick<TrainingLoadResult, 'bootstrapping' | 'points' | 'workouts' | 'zones'>

/** The bar-aligned buckets the steps and calories y-scales are sized from. */
export const barAggregatedBuckets = (
  metricBuckets: MetricBucketParsed[],
  barBucketSize: BarBucketSize,
): MetricBucketParsed[] =>
  metricBuckets.length >= 2 &&
  metricBuckets[1]!.start.getTime() - metricBuckets[0]!.start.getTime() < BAR_BUCKET_NOMINAL_MS[barBucketSize]
    ? aggregateBucketsAligned(metricBuckets, barBucketSize)
    : metricBuckets

export interface MetricsLaneConfig {
  /** Draws are appended here; it may be a rotated group, since everything is drawn as x = time, y = value. */
  chartGroup: SvgGroup
  /** Holds the crosshair overlay. */
  outerG: SvgGroup
  xScale: d3.ScaleTime<number, number>
  trackY: number
  trackHeight: number
  /** Length of the time axis in pixels. */
  chartWidth: number
  pixelsPerHour: number
  domainStartMs: number
  domainEndMs: number
  metricBuckets: MetricBucketParsed[]
  yScales: MetricsYScales | null
  barBucketSize: BarBucketSize
  hidden: ReadonlySet<LegendCategory>
  screentimeBuckets: ScreentimeBucketParsed[]
  screentimeCategories: ScreentimeCategory[]
  /** Null where training load is not drawn (the vertical layout). */
  trainingLoad: TrainingLoadData | null
  showTooltipHtml: (event: MouseEvent, html: string) => void
  hideTooltip: () => void
}

/** The Metrics lane's content, shared by both layouts: ribbons, stress, steps, calories,
 * screen time bars and, horizontally, training load. */
// eslint-disable-next-line complexity -- one visibility flag per series, as drawMetricsTrack takes them
export const drawMetricsLane = (config: MetricsLaneConfig): void => {
  const { chartGroup, xScale, trackY, trackHeight, hidden, trainingLoad, metricBuckets, barBucketSize } =
    config

  const showHR = !hidden.has('hr')
  const showHRV = !hidden.has('hrv')
  const showStress = !hidden.has('stress')
  const showSteps = !hidden.has('steps')
  const showCalories = !hidden.has('calories')
  const showTL = !hidden.has('training_load')
  const showScreentime = !hidden.has('screen_time_h')
  const screentimeBuckets = config.screentimeBuckets
  const screentimeHasData = screentimeBuckets.length > 0

  const barLayout = computeBarLayout([
    { id: 'fatigue', visible: showTL && !!trainingLoad },
    { id: 'impulse', visible: showTL && !!trainingLoad },
    { id: 'screentime', visible: showScreentime && screentimeHasData },
    { id: 'steps', visible: showSteps },
    { id: 'calories', visible: showCalories },
  ])

  if (config.yScales || (showTL && trainingLoad) || screentimeHasData) {
    drawMetricsTrack({
      buckets: visibleBuckets(
        metricBuckets,
        config.domainStartMs,
        config.domainEndMs,
        barBucketSize,
        LINE_CHUNK_ALIGNMENT,
      ),
      chartGroup,
      chartWidth: config.chartWidth,
      hideTooltip: config.hideTooltip,
      outerG: config.outerG,
      pixelsPerHour: config.pixelsPerHour,
      showCalories,
      showHR,
      showHRV,
      showSteps,
      showStress,
      showTooltipHtml: config.showTooltipHtml,
      trackHeight,
      trackY,
      yScales: config.yScales ?? computeYScales([], trackY, trackY + trackHeight),
      xScale,
      barBucketSize,
      barLayout,
      caloriesSlotId: 'calories',
      stepsSlotId: 'steps',
      ...(showScreentime && screentimeHasData
        ? { screentimeBuckets, screentimeCategories: config.screentimeCategories }
        : {}),
      ...(showTL && trainingLoad
        ? {
            trainingLoadPoints: trainingLoad.points,
            trainingLoadWorkouts: trainingLoad.workouts,
            trainingLoadZones: trainingLoad.zones ?? undefined,
          }
        : {}),
    })
  }

  if (showTL && trainingLoad) {
    drawTrainingLoadTrack({
      barLayout,
      bootstrapping: trainingLoad.bootstrapping,
      chartGroup,
      fatigueSlotId: 'fatigue',
      impulseSlotId: 'impulse',
      points: trainingLoad.points,
      trackHeight,
      trackY,
      workouts: trainingLoad.workouts,
      xScale,
      zones: trainingLoad.zones ?? undefined,
    })
  }

  if (showScreentime && screentimeHasData) {
    drawScreentimeBars({
      barLayout,
      buckets: screentimeBuckets,
      categories: config.screentimeCategories,
      chartGroup,
      slotId: 'screentime',
      trackHeight,
      trackY,
      xScale,
    })
  }
}
