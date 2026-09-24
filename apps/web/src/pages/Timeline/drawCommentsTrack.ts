import type * as d3 from 'd3'

import type { ChartItem } from './types'

import { attachItemClick, drawItemIcon } from './drawItems'

/** Height reserved for the horizontal 💬 lane when it has something to show. */
export const COMMENTS_TRACK_HEIGHT = 28

const GLYPH_SIZE = 18
const SPAN_BAR_HEIGHT = 3

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SvgParent = d3.Selection<any, unknown, null, undefined>

export interface DrawCommentsTrackConfig {
  chartGroup: SvgParent
  /** Comments track items already filtered to the viewport. */
  items: ChartItem[]
  xScale: d3.ScaleTime<number, number>
  trackY: number
  showTooltip: (event: MouseEvent, item: ChartItem) => void
  hideTooltip: () => void
  onItemClick?: (item: ChartItem) => void
}

/**
 * The horizontal comments lane: one 💬 glyph centred on each thread root's
 * start, with a thin bar underneath when the comment covers a span rather than
 * a moment.
 */
export const drawCommentsTrack = ({
  chartGroup,
  items,
  xScale,
  trackY,
  showTooltip,
  hideTooltip,
  onItemClick,
}: DrawCommentsTrackConfig): void => {
  for (const item of items) {
    const x = xScale(item.start)

    if (!item.isPoint) {
      chartGroup
        .append('rect')
        .attr('x', x)
        .attr('y', trackY + COMMENTS_TRACK_HEIGHT - SPAN_BAR_HEIGHT - 3)
        .attr('width', Math.max(2, xScale(item.end) - x))
        .attr('height', SPAN_BAR_HEIGHT)
        .attr('rx', SPAN_BAR_HEIGHT / 2)
        .attr('fill', item.color)
        .attr('opacity', 0.7)
        .attr('pointer-events', 'none')
    }

    const glyph = drawItemIcon(chartGroup, item.icon, x, trackY + GLYPH_SIZE / 2, GLYPH_SIZE, {
      cursor: 'pointer',
      pointerEvents: 'all',
    })
    if (!glyph) continue

    glyph.on('mouseenter', (event: MouseEvent) => showTooltip(event, item)).on('mouseleave', hideTooltip)
    attachItemClick(glyph, item, onItemClick)
  }
}
