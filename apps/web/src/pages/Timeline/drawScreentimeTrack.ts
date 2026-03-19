/**
 * Draw the screentime stacked bar chart in the horizontal timeline metrics track.
 *
 * Each bucket is a single stacked bar showing time by top-level category,
 * with category colors applied to segments.
 */
import type { ScreentimeCategory } from '@aurboda/api-spec'

import * as d3 from 'd3'
import { format } from 'date-fns'

import type { ScreentimeBucketParsed } from '../../state/api'

import { type BarLayoutResult, slotPixels } from './barLayout'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SvgGroup = d3.Selection<SVGGElement, unknown, any, any>

export const SCREENTIME_COLOR = '#6366f1' // indigo default

/** Default colors for uncategorized screentime. */
const UNCATEGORIZED_COLOR = '#6b7280' // gray

/** Get the color for a top-level category from the category list. */
const getCategoryColor = (topLevel: string, categories: ScreentimeCategory[]): string => {
  // Walk from exact match to parent
  for (const cat of categories) {
    if (cat.name[0] === topLevel && cat.color) return cat.color
  }
  return SCREENTIME_COLOR
}

/** Aggregate bucket categories to top-level for the stacked bar. */
interface TopLevelCategory {
  name: string
  total_sec: number
  color: string
  /** Full paths for tooltip hierarchy. */
  children: Array<{ path: string[]; total_sec: number }>
}

const aggregateToTopLevel = (
  bucket: ScreentimeBucketParsed,
  categories: ScreentimeCategory[],
): TopLevelCategory[] => {
  const map = new Map<string, TopLevelCategory>()
  let uncategorizedSec = 0

  for (const cat of bucket.categories) {
    if (cat.path.length === 0) {
      uncategorizedSec += cat.total_sec
      continue
    }
    const topLevel = cat.path[0]
    let entry = map.get(topLevel)
    if (!entry) {
      entry = {
        children: [],
        color: getCategoryColor(topLevel, categories),
        name: topLevel,
        total_sec: 0,
      }
      map.set(topLevel, entry)
    }
    entry.total_sec += cat.total_sec
    entry.children.push({ path: cat.path, total_sec: cat.total_sec })
  }

  if (uncategorizedSec > 0) {
    map.set('', {
      children: [{ path: [], total_sec: uncategorizedSec }],
      color: UNCATEGORIZED_COLOR,
      name: 'Uncategorized',
      total_sec: uncategorizedSec,
    })
  }

  // Sort by duration descending (biggest at bottom of stack)
  return [...map.values()].sort((a, b) => b.total_sec - a.total_sec)
}

/** Format seconds as compact duration (e.g. "2h 15m", "45m"). */
const formatSec = (sec: number): string => {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

// ── Drawing ──────────────────────────────────────────────────────────────────

export interface DrawScreentimeConfig {
  chartGroup: SvgGroup
  buckets: ScreentimeBucketParsed[]
  categories: ScreentimeCategory[]
  xScale: d3.ScaleTime<number, number>
  trackY: number
  trackHeight: number
  barLayout: BarLayoutResult
  slotId: string
}

export const drawScreentimeBars = (config: DrawScreentimeConfig): void => {
  const { chartGroup, buckets, categories, xScale, trackY, trackHeight, barLayout, slotId } = config
  if (buckets.length === 0) return

  const trackBottom = trackY + trackHeight

  // Y-scale: 0 at bottom, bucket duration at top.
  // For 1h buckets, 3600 sec = full track height. 57 min = 95% height.
  const bucketDurationSec =
    buckets.length >= 2
      ? (buckets[1].end.getTime() - buckets[1].start.getTime()) / 1000
      : buckets[0]
        ? (buckets[0].end.getTime() - buckets[0].start.getTime()) / 1000
        : 3600

  const yScale = d3.scaleLinear().domain([0, bucketDurationSec]).range([trackBottom, trackY])

  const slotOffset = barLayout.getOffset(slotId)

  for (const bucket of buckets) {
    if (bucket.total_sec <= 0) continue

    const bucketX = xScale(bucket.start)
    const bucketEnd = xScale(bucket.end)
    const bucketWidth = Math.abs(bucketEnd - bucketX)

    const { x: barX, width: barWidth } = slotPixels(bucketX, bucketWidth, slotOffset, barLayout.slotWidth)
    if (barWidth < 1) continue

    const topLevels = aggregateToTopLevel(bucket, categories)

    // Draw stacked segments bottom-up
    let stackY = trackBottom
    for (const cat of topLevels) {
      const segHeight = trackBottom - yScale(cat.total_sec)
      if (segHeight <= 0) continue

      chartGroup
        .append('rect')
        .attr('x', barX)
        .attr('y', stackY - segHeight)
        .attr('width', barWidth)
        .attr('height', segHeight)
        .attr('fill', cat.color)
        .attr('opacity', 0.7)
        .attr('pointer-events', 'none')

      stackY -= segHeight
    }
  }
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

/**
 * Build the screentime tooltip HTML section for a given bucket.
 * Shows hierarchical breakdown by category.
 */
export const buildScreentimeTooltipHtml = (
  bucket: ScreentimeBucketParsed,
  categories: ScreentimeCategory[],
): string | null => {
  if (bucket.total_sec <= 0) return null

  const topLevels = aggregateToTopLevel(bucket, categories)

  let html = '<div class="tooltip-separator"></div>'
  html += '<div class="tooltip-title">Screen Time</div>'
  html += `<div class="tooltip-time">${format(bucket.start, 'HH:mm')} – ${format(bucket.end, 'HH:mm')}</div>`
  html += `<div class="tooltip-detail"><strong>Total</strong> <span>${formatSec(bucket.total_sec)}</span></div>`

  for (const cat of topLevels) {
    html += `<div class="tooltip-detail" style="padding-left:8px">`
    html += `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${cat.color};margin-right:4px"></span>`
    html += `<strong>${cat.name}</strong> <span>${formatSec(cat.total_sec)}</span></div>`

    // Show sub-categories if there are multiple children
    const children = cat.children.filter((c) => c.path.length > 1).sort((a, b) => b.total_sec - a.total_sec)

    for (const child of children) {
      const label = child.path.slice(1).join(' > ')
      html += `<div class="tooltip-detail" style="padding-left:24px;font-size:11px;color:#9ca3af">`
      html += `${label} <span>${formatSec(child.total_sec)}</span></div>`
    }
  }

  return html
}

/**
 * Find the screentime bucket that contains the given date.
 */
export const findScreentimeBucket = (
  buckets: ScreentimeBucketParsed[],
  date: Date,
): ScreentimeBucketParsed | undefined => {
  const t = date.getTime()
  for (const b of buckets) {
    if (t >= b.start.getTime() && t < b.end.getTime()) return b
  }
  return undefined
}
