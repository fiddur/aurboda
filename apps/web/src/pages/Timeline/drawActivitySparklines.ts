/**
 * Draw HR and HRV sparkline overlays inside activity blocks on the Day view.
 */
import type { QueryMetricsBucketedResponse } from '@aurboda/api-spec'

import * as d3 from 'd3'

import type { ChartItem } from './types'

/** Metric bucket with parsed Date for the start timestamp. */
interface ParsedBucket {
  start: Date
  hr?: number
  hrv?: number
}

const HR_COLOR = '#ef4444' // red
const HRV_COLOR = '#14b8a6' // teal

/** HR domain range for sparklines (bpm) */
const HR_RANGE: [number, number] = [40, 200]
/** HRV domain range for sparklines (ms) */
const HRV_RANGE: [number, number] = [0, 150]

/** Minimum block height in pixels before we attempt to draw sparklines. */
const MIN_SPARKLINE_HEIGHT = 40

/**
 * Parse bucketed metrics response into an array of timestamped data points.
 */
export const parseBucketedData = (data: QueryMetricsBucketedResponse | undefined): ParsedBucket[] => {
  if (!data?.buckets) return []
  return data.buckets.map((b) => ({
    hr: b.metrics.heart_rate?.avg,
    hrv: b.metrics.hrv_rmssd?.avg,
    start: new Date(b.start),
  }))
}

/**
 * Draw sparkline overlays for all activity items in the chart.
 * Uses SVG clip paths to keep sparklines within their activity block bounds.
 */
export const drawActivitySparklines = (
  chartGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  defs: d3.Selection<SVGDefsElement, unknown, null, undefined>,
  items: ChartItem[],
  buckets: ParsedBucket[],
  yScale: d3.ScaleTime<number, number>,
  showHR: boolean,
  showHRV: boolean,
  getItemRect: (item: ChartItem) => { x: number; width: number } | undefined,
) => {
  if (buckets.length === 0 || (!showHR && !showHRV)) return

  const activityItems = items.filter((item) => item.activity_type && !item.isPoint)

  for (const item of activityItems) {
    const rect = getItemRect(item)
    if (!rect) continue

    const y1 = yScale(item.start)
    const y2 = yScale(item.end)
    const blockHeight = Math.abs(y2 - y1)

    if (blockHeight < MIN_SPARKLINE_HEIGHT) continue

    // Filter buckets within this activity's time range
    const activityBuckets = buckets.filter((b) => b.start >= item.start && b.start <= item.end)

    if (activityBuckets.length < 2) continue

    // Create a unique clip path for this sparkline
    const clipId = `sparkline-clip-${item.entity_id ?? `${item.start.getTime()}`}`
    defs
      .append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('x', rect.x)
      .attr('y', Math.min(y1, y2))
      .attr('width', rect.width)
      .attr('height', blockHeight)
      .attr('rx', 3)

    const sparkGroup = chartGroup
      .append('g')
      .attr('clip-path', `url(#${clipId})`)
      .attr('pointer-events', 'none')

    if (showHR) {
      const hrPoints = activityBuckets.filter((b) => b.hr !== undefined)
      if (hrPoints.length >= 2) {
        drawSparkline(
          sparkGroup,
          hrPoints.map((b) => ({ time: b.start, value: b.hr! })),
          yScale,
          rect.x,
          rect.width,
          HR_COLOR,
          HR_RANGE,
        )
      }
    }

    if (showHRV) {
      const hrvPoints = activityBuckets.filter((b) => b.hrv !== undefined)
      if (hrvPoints.length >= 2) {
        drawSparkline(
          sparkGroup,
          hrvPoints.map((b) => ({ time: b.start, value: b.hrv! })),
          yScale,
          rect.x,
          rect.width,
          HRV_COLOR,
          HRV_RANGE,
        )
      }
    }
  }
}

/**
 * Draw a single sparkline (line + area fill) inside an activity block.
 * The x-axis maps the metric value, and the y-axis is the time (matching the main chart).
 */
const drawSparkline = (
  group: d3.Selection<SVGGElement, unknown, null, undefined>,
  data: { time: Date; value: number }[],
  yScale: d3.ScaleTime<number, number>,
  blockX: number,
  blockWidth: number,
  color: string,
  valueDomain: [number, number],
) => {
  // x-axis maps value → horizontal position within the block
  const xScale = d3
    .scaleLinear()
    .domain(valueDomain)
    .range([blockX + 2, blockX + blockWidth - 2])
    .clamp(true)

  // Line generator: x = metric value, y = time position
  const line = d3
    .line<{ time: Date; value: number }>()
    .x((d) => xScale(d.value))
    .y((d) => yScale(d.time))
    .curve(d3.curveMonotoneY)

  // Area fill from the left edge
  const area = d3
    .area<{ time: Date; value: number }>()
    .x0(blockX)
    .x1((d) => xScale(d.value))
    .y((d) => yScale(d.time))
    .curve(d3.curveMonotoneY)

  // Draw area fill
  group.append('path').datum(data).attr('d', area).attr('fill', color).attr('fill-opacity', 0.12)

  // Draw line
  group
    .append('path')
    .datum(data)
    .attr('d', line)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 1.2)
    .attr('stroke-opacity', 0.6)
}
