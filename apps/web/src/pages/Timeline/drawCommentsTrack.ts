import type * as d3 from 'd3'

import type { ChartItem } from './types'

import { buildCommentGroupItem, groupOverlappingComments } from './commentItems'
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
 * a moment. Roots whose glyphs would overlap share one glyph with a count.
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
    if (item.isPoint) continue
    const x = xScale(item.start)
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

  const points = items.map((item) => ({ item, x: xScale(item.start) }))
  for (const group of groupOverlappingComments(points, GLYPH_SIZE)) {
    const x = group[0]!.x
    const item = group.length === 1 ? group[0]!.item : buildCommentGroupItem(group.map((p) => p.item))

    const glyph = drawItemIcon(chartGroup, item.icon, x, trackY + GLYPH_SIZE / 2, GLYPH_SIZE, {
      cursor: 'pointer',
      pointerEvents: 'all',
    })
    if (!glyph) continue

    glyph.on('mouseenter', (event: MouseEvent) => showTooltip(event, item)).on('mouseleave', hideTooltip)
    attachItemClick(glyph, item, onItemClick)

    if (group.length > 1) {
      chartGroup
        .append('text')
        .attr('x', x + GLYPH_SIZE / 2)
        .attr('y', trackY + 2)
        .attr('dominant-baseline', 'hanging')
        .attr('font-size', '0.6rem')
        .attr('font-weight', '700')
        .attr('fill', item.color)
        .attr('pointer-events', 'none')
        .text(group.length)
    }
  }
}
