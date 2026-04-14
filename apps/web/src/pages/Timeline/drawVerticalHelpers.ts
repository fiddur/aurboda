import * as d3 from 'd3'
import { formatISO } from 'date-fns'

import type { ChartItem, Column } from './types'

import { isEmoji, isIconPath, isUrl } from '../../utils/emojiLookup'
import { NOW_COLOR } from './colors'
import { formatTime } from './formatting'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SvgParent = d3.Selection<any, unknown, null, undefined>

export type ColumnDataEntry = {
  column: Column
  items: { item: ChartItem; lane: number }[]
  laneCount: number
}

export const MIN_ITEM_HEIGHT = 4

// ── Pure helpers (testable) ──────────────────────────────────────────────────

export const mergeSmallItems = (
  packedItems: { item: ChartItem; lane: number }[],
  yScale: d3.ScaleTime<number, number>,
): { item: ChartItem; lane: number }[] => {
  if (packedItems.length === 0) return packedItems

  const sorted = [...packedItems].sort((a, b) => a.item.start.getTime() - b.item.start.getTime())
  const anyTiny = sorted.some(({ item }) => {
    const h = Math.abs(yScale(item.end) - yScale(item.start))
    return h < MIN_ITEM_HEIGHT
  })
  if (!anyTiny) return packedItems

  const result: { item: ChartItem; lane: number }[] = []
  let cluster: { item: ChartItem; lane: number }[] = []

  const flushCluster = () => {
    if (cluster.length === 0) return
    if (cluster.length === 1) {
      result.push(cluster[0]!)
    } else {
      const items = cluster.map((c) => c.item)
      const mergedStart = items.reduce((min, i) => (i.start < min ? i.start : min), items[0]!.start)
      const mergedEnd = items.reduce((max, i) => (i.end > max ? i.end : max), items[0]!.end)
      const first = items[0]!
      // Build a Data page link showing only the relevant type for this time range
      const columnToDataType: Partial<Record<Column, string>> = {
        Activity: 'activity',
        Exercise: 'activity',
        Location: 'location',
        Music: 'music',
        'Screen Time': 'screentime',
        'Sleep / Rest': 'activity',
      }
      const dataType = columnToDataType[first.column]
      const allDataTypes = ['activity', 'location', 'music', 'meal', 'report', 'screentime']
      const hideTypes = dataType ? allDataTypes.filter((t) => t !== dataType) : []
      const dataParams = new URLSearchParams({
        date: formatISO(mergedStart, { representation: 'date' }),
        from: mergedStart.toISOString(),
        to: mergedEnd.toISOString(),
      })
      if (hideTypes.length > 0) dataParams.set('hide', hideTypes.join(','))

      const merged: ChartItem = {
        color: first.color,
        column: first.column,
        end: mergedEnd,
        href: `/data?${dataParams}`,
        isPoint: false,
        label: `${items.length} items`,
        start: mergedStart,
        tooltip: {
          details: items.map((i) => `${formatTime(i.start)} ${i.label}`),
          time: `${formatTime(mergedStart)} – ${formatTime(mergedEnd)}`,
          title: `${items.length} ${first.column}`,
        },
      }
      result.push({ item: merged, lane: 0 })
    }
    cluster = []
  }

  for (const packed of sorted) {
    const h = Math.abs(yScale(packed.item.end) - yScale(packed.item.start))
    // Keep items that are tall enough, or any item (block or point) that has an icon —
    // icons are always shown regardless of height, so never merge them into a cluster.
    if (h >= MIN_ITEM_HEIGHT || packed.item.icon) {
      flushCluster()
      result.push(packed)
      continue
    }

    if (cluster.length === 0) {
      cluster.push(packed)
    } else {
      const clusterEnd = cluster.reduce(
        (max, c) => (c.item.end > max ? c.item.end : max),
        cluster[0]!.item.end,
      )
      const gapPx = yScale(packed.item.start) - yScale(clusterEnd)
      if (gapPx <= MIN_ITEM_HEIGHT * 2) {
        cluster.push(packed)
      } else {
        flushCluster()
        cluster.push(packed)
      }
    }
  }
  flushCluster()

  return result
}

export const stackIconPoints = (
  items: { item: ChartItem; lane: number }[],
  usableWidth: number,
): { item: ChartItem; lane: number; xOffset: number }[] => {
  const pointItems = items.filter((p) => p.item.isPoint)
  if (pointItems.length <= 1) return items.map((p) => ({ ...p, xOffset: 0 }))

  const byTime = new Map<number, { item: ChartItem; lane: number }[]>()
  for (const p of pointItems) {
    const t = p.item.start.getTime()
    const group = byTime.get(t) ?? []
    group.push(p)
    byTime.set(t, group)
  }

  const stackedSet = new Set<ChartItem>()
  const offsetMap = new Map<ChartItem, number>()

  for (const group of byTime.values()) {
    if (group.length <= 1) continue
    group.sort((a, b) => a.item.label.localeCompare(b.item.label))
    // Adapt step size so all icons fit within the available column width
    const maxStep = 18
    const step = Math.min(maxStep, Math.max(8, Math.floor((usableWidth - 20) / group.length)))
    for (let i = 0; i < group.length; i++) {
      stackedSet.add(group[i]!.item)
      offsetMap.set(group[i]!.item, i * step)
    }
  }

  return items.map((p) => {
    if (stackedSet.has(p.item)) {
      return { item: p.item, lane: 0, xOffset: offsetMap.get(p.item) ?? 0 }
    }
    return { ...p, xOffset: 0 }
  })
}

// ── D3 drawing functions ─────────────────────────────────────────────────────

export const drawPointMarker = (
  parent: SvgParent,
  item: ChartItem,
  cx: number,
  cy: number,
  size: number,
  laneWidth: number,
  boxHeight: number,
  x: number,
  detailUrl: string | undefined,
  showTooltip: (event: MouseEvent, item: ChartItem) => void,
  hideTooltip: () => void,
): void => {
  const cursor = detailUrl ? 'pointer' : 'default'

  const iconSize = Math.max(18, Math.min(laneWidth, boxHeight))

  if (item.icon && isEmoji(item.icon)) {
    parent
      .append('text')
      .attr('x', cx)
      .attr('y', cy)
      .attr('dominant-baseline', 'central')
      .attr('text-anchor', 'middle')
      .attr('font-size', `${iconSize * 0.75}px`)
      .attr('pointer-events', 'all')
      .attr('cursor', cursor)
      .text(item.icon)
      .on('mouseenter', (event: MouseEvent) => showTooltip(event, item))
      .on('mouseleave', hideTooltip)
    return
  }

  if (item.icon && (isUrl(item.icon) || isIconPath(item.icon))) {
    parent
      .append('image')
      .attr('href', item.icon)
      .attr('x', cx - iconSize / 2)
      .attr('y', cy - iconSize / 2)
      .attr('width', iconSize)
      .attr('height', iconSize)
      .attr('pointer-events', 'all')
      .attr('cursor', cursor)
      .on('mouseenter', (event: MouseEvent) => showTooltip(event, item))
      .on('mouseleave', hideTooltip)
    return
  }

  parent
    .append('polygon')
    .attr('points', `${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`)
    .attr('fill', item.color)
    .attr('opacity', 0.85)
    .on('mouseenter', (event: MouseEvent) => showTooltip(event, item))
    .on('mouseleave', hideTooltip)

  const labelX = x + 2 * size + 6
  const availableWidth = laneWidth - 2 * size - 8
  if (availableWidth > 20) {
    const charWidth = 5.5
    const maxChars = Math.floor(availableWidth / charWidth)
    const text = item.label.length > maxChars ? item.label.slice(0, maxChars) + '…' : item.label
    parent
      .append('text')
      .attr('x', labelX)
      .attr('y', cy)
      .attr('dy', '0.35em')
      .attr('fill', item.color)
      .attr('font-size', '0.6rem')
      .attr('opacity', 0.8)
      .attr('pointer-events', 'none')
      .text(text)
  }
}

export const drawBlockOverlay = (
  parent: SvgParent,
  item: ChartItem,
  x: number,
  y1: number,
  laneWidth: number,
  blockHeight: number,
): void => {
  const iconSize = Math.max(18, Math.min(laneWidth, blockHeight))
  if (item.icon && isEmoji(item.icon)) {
    parent
      .append('text')
      .attr('x', x + laneWidth / 2)
      .attr('y', y1 + blockHeight / 2)
      .attr('dominant-baseline', 'central')
      .attr('text-anchor', 'middle')
      .attr('font-size', `${iconSize * 0.75}px`)
      .attr('pointer-events', 'none')
      .text(item.icon)
    return
  }

  if (item.icon && (isUrl(item.icon) || isIconPath(item.icon))) {
    parent
      .append('image')
      .attr('href', item.icon)
      .attr('x', x + laneWidth / 2 - iconSize / 2)
      .attr('y', y1 + blockHeight / 2 - iconSize / 2)
      .attr('width', iconSize)
      .attr('height', iconSize)
      .attr('pointer-events', 'none')
    return
  }

  if (blockHeight > 30) {
    const fontSize = laneWidth > 100 ? '0.8rem' : '0.65rem'
    const charWidth = laneWidth > 100 ? 7.5 : 6
    const maxChars = Math.floor(laneWidth / charWidth)
    const text = item.label.length > maxChars ? item.label.slice(0, maxChars) + '…' : item.label
    parent
      .append('text')
      .attr('x', x + 4)
      .attr('y', y1 + 14)
      .attr('fill', 'white')
      .attr('font-size', fontSize)
      .attr('font-weight', '500')
      .attr('pointer-events', 'none')
      .text(text)
  }
}

export const drawItem = (
  chartGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  item: ChartItem,
  lane: number,
  colX: number,
  laneWidth: number,
  colPadding: number,
  yScale: d3.ScaleTime<number, number>,
  showTooltip: (event: MouseEvent, item: ChartItem) => void,
  hideTooltip: () => void,
  xOffset = 0,
): void => {
  const y1 = yScale(item.start)
  const y2 = yScale(item.end)
  const x = colX + lane * (laneWidth + colPadding) + xOffset
  const blockHeight = Math.max(y2 - y1, 2)

  const detailUrl =
    item.entity_id && item.entity_type
      ? `/detail/${item.entity_type}/${encodeURIComponent(item.entity_id)}`
      : (item.href ?? undefined)

  const parent: SvgParent = detailUrl
    ? chartGroup.append('a').attr('href', detailUrl).attr('data-clickable', 'true')
    : chartGroup

  if (item.isPoint) {
    const size = Math.min(laneWidth / 2, 6)
    drawPointMarker(
      parent,
      item,
      x + size + 2,
      y1,
      size,
      laneWidth,
      blockHeight,
      x,
      detailUrl,
      showTooltip,
      hideTooltip,
    )
    return
  }

  parent
    .append('rect')
    .attr('x', x)
    .attr('y', y1)
    .attr('width', laneWidth)
    .attr('height', blockHeight)
    .attr('rx', 3)
    .attr('ry', 3)
    .attr('fill', item.color)
    .attr('opacity', 0.75)
    .on('mouseenter', function (event: MouseEvent) {
      d3.select(this).attr('opacity', 0.95)
      showTooltip(event, item)
    })
    .on('mouseleave', function () {
      d3.select(this).attr('opacity', 0.75)
      hideTooltip()
    })

  drawBlockOverlay(parent, item, x, y1, laneWidth, blockHeight)
}

export const drawColumnItems = (
  chartGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  columnData: ColumnDataEntry[],
  colWidth: number,
  colGap: number,
  colPadding: number,
  yScale: d3.ScaleTime<number, number>,
  showTooltip: (event: MouseEvent, item: ChartItem) => void,
  hideTooltip: () => void,
): void => {
  for (let colIdx = 0; colIdx < columnData.length; colIdx++) {
    const { items: packedItems, laneCount } = columnData[colIdx]!

    const mergedItems = mergeSmallItems(packedItems, yScale)
    const hasMerged = mergedItems.some((m) => m.item.label.endsWith(' items'))

    const colX = colIdx * colWidth + colGap
    const usableWidth = colWidth - colGap * 2

    const stackedItems = stackIconPoints(mergedItems, usableWidth)

    const hasStacked = stackedItems.some((s) => s.xOffset > 0)
    const nonStackedLanes = hasStacked
      ? Math.max(1, ...stackedItems.filter((s) => s.xOffset === 0 && !s.item.isPoint).map((s) => s.lane + 1))
      : laneCount
    const effectiveLanes = hasMerged ? 1 : Math.max(nonStackedLanes, 1)
    const laneWidth = (usableWidth - (effectiveLanes - 1) * colPadding) / effectiveLanes

    for (const { item, lane, xOffset } of stackedItems) {
      const effectiveLane = hasMerged ? 0 : lane
      drawItem(
        chartGroup,
        item,
        effectiveLane,
        colX,
        laneWidth,
        colPadding,
        yScale,
        showTooltip,
        hideTooltip,
        xOffset,
      )
    }
  }
}

// ── Now line helpers ─────────────────────────────────────────────────────────

export const drawNowLine = (
  chartGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  chartWidth: number,
  yScale: d3.ScaleTime<number, number>,
): void => {
  const now = new Date()
  const domain = yScale.domain()
  if (now < domain[0]! || now > domain[1]!) return

  const nowY = yScale(now)
  chartGroup
    .append('line')
    .attr('x1', 0)
    .attr('x2', chartWidth)
    .attr('y1', nowY)
    .attr('y2', nowY)
    .attr('stroke', NOW_COLOR)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '6,3')
  chartGroup
    .append('text')
    .attr('x', chartWidth + 4)
    .attr('y', nowY)
    .attr('dy', '0.35em')
    .attr('fill', NOW_COLOR)
    .attr('font-size', '0.65rem')
    .attr('font-weight', '600')
    .text('Now')
}

export const drawHorizontalNowLine = (
  chartGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  chartHeight: number,
  xScale: d3.ScaleTime<number, number>,
): void => {
  const now = new Date()
  const domain = xScale.domain()
  if (now < domain[0]! || now > domain[1]!) return

  const nowX = xScale(now)
  chartGroup
    .append('line')
    .attr('x1', nowX)
    .attr('x2', nowX)
    .attr('y1', 0)
    .attr('y2', chartHeight)
    .attr('stroke', NOW_COLOR)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '6,3')
  chartGroup
    .append('text')
    .attr('x', nowX)
    .attr('y', -4)
    .attr('text-anchor', 'middle')
    .attr('fill', NOW_COLOR)
    .attr('font-size', '0.65rem')
    .attr('font-weight', '600')
    .text('Now')
}
