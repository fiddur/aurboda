import * as d3 from 'd3'

import type { ChartItem } from './types'

import { isEmoji, isIconPath, isUrl } from '../../utils/emojiLookup'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SvgParent = d3.Selection<any, unknown, null, undefined>

/**
 * Resolve the detail URL for a chart item. An explicit `href` wins over the
 * generic `/detail/{type}/{id}` route — some entity types (e.g. meals) live
 * outside the EntityDetail page and set `href` to their own route.
 */
export const getDetailUrl = (item: ChartItem): string | undefined =>
  item.href ??
  (item.entity_id && item.entity_type
    ? `/detail/${item.entity_type}/${encodeURIComponent(item.entity_id)}`
    : undefined)

/**
 * Render an emoji or image icon centered at (cx, cy).
 * Returns the created SVG element selection, or null if no icon was available.
 */
export const drawItemIcon = (
  parent: SvgParent,
  icon: string | undefined,
  cx: number,
  cy: number,
  iconSize: number,
  opts?: {
    pointerEvents?: 'all' | 'none'
    cursor?: string
  },
): SvgParent | null => {
  const pointerEvents = opts?.pointerEvents ?? 'none'
  const cursor = opts?.cursor ?? 'default'

  if (icon && isEmoji(icon)) {
    // Emoji glyphs render visually lower than their em-box center (extra descender
    // space for legs/feet). Nudge up by 10% of icon size to align the visual center
    // with the geometric center of the container.
    const emojiY = cy - iconSize * 0.1
    return parent
      .append('text')
      .attr('x', cx)
      .attr('y', emojiY)
      .attr('dominant-baseline', 'central')
      .attr('text-anchor', 'middle')
      .attr('font-size', `${iconSize * 0.75}px`)
      .attr('pointer-events', pointerEvents)
      .attr('cursor', cursor)
      .text(icon)
  }

  if (icon && (isUrl(icon) || isIconPath(icon))) {
    return parent
      .append('image')
      .attr('href', icon)
      .attr('x', cx - iconSize / 2)
      .attr('y', cy - iconSize / 2)
      .attr('width', iconSize)
      .attr('height', iconSize)
      .attr('pointer-events', pointerEvents)
      .attr('cursor', cursor)
  }

  return null
}

/**
 * Attach mouseenter/mouseleave hover handlers that toggle opacity and show/hide tooltip.
 */
export const attachHoverHandlers = (
  selection: SvgParent,
  item: ChartItem,
  showTooltip: (event: MouseEvent, item: ChartItem) => void,
  hideTooltip: () => void,
  restOpacity = 0.7,
  hoverOpacity = 0.9,
): void => {
  selection
    .on('mouseenter', function (event: MouseEvent) {
      d3.select(this).attr('opacity', hoverOpacity)
      showTooltip(event, item)
    })
    .on('mouseleave', function () {
      d3.select(this).attr('opacity', restOpacity)
      hideTooltip()
    })
}

/**
 * How far the pointer may travel between press and release and still count as a
 * click rather than a pan. The chart is drag-to-pan, so a press that starts on a
 * comment bubble and ends 200px away must not open its panel.
 */
export const CLICK_MOVE_TOLERANCE_PX = 4

/**
 * Make a drawn element open something on click (used by the comments track,
 * which has no detail URL and so is never wrapped in an `<a>`). A no-op unless
 * both a handler and a `comment_id` are present.
 */
export const attachItemClick = (
  selection: SvgParent,
  item: ChartItem,
  onItemClick: ((item: ChartItem) => void) | undefined,
): void => {
  if (!onItemClick || !item.comment_id) return

  let downX = 0
  let downY = 0
  selection
    .attr('cursor', 'pointer')
    .on('pointerdown', (event: PointerEvent) => {
      downX = event.clientX
      downY = event.clientY
    })
    .on('click', (event: MouseEvent) => {
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > CLICK_MOVE_TOLERANCE_PX) return
      event.preventDefault()
      event.stopPropagation()
      onItemClick(item)
    })
}

/**
 * Truncate a label to fit within a pixel width, assuming a fixed character width.
 */
export const truncateLabel = (label: string, widthPx: number, charWidth = 6): string => {
  const maxChars = Math.floor(widthPx / charWidth)
  if (label.length <= maxChars) return label
  return label.slice(0, Math.max(maxChars - 1, 0)) + '…'
}

/**
 * Position a label inside a horizontal bar so it stays inside the visible chart
 * region even when the bar starts before the chart's left edge (e.g. an activity
 * spanning midnight). Returns the clamped x and the remaining width available
 * for truncation.
 */
export const clampLabelLayout = (
  barStartX: number,
  barWidth: number,
  padding: number,
  chartLeftX = 0,
): { x: number; width: number } => {
  const barEndX = barStartX + barWidth
  const x = Math.max(barStartX + padding, chartLeftX + padding)
  const width = Math.max(0, barEndX - x - padding)
  return { x, width }
}
