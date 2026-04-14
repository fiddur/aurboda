import * as d3 from 'd3'

import type { ChartItem } from './types'

import { isEmoji, isIconPath, isUrl } from '../../utils/emojiLookup'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SvgParent = d3.Selection<any, unknown, null, undefined>

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
    return parent
      .append('text')
      .attr('x', cx)
      .attr('y', cy)
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
 * Truncate a label to fit within a pixel width, assuming a fixed character width.
 */
export const truncateLabel = (label: string, widthPx: number, charWidth = 6): string => {
  const maxChars = Math.floor(widthPx / charWidth)
  if (label.length <= maxChars) return label
  return label.slice(0, Math.max(maxChars - 1, 0)) + '…'
}
