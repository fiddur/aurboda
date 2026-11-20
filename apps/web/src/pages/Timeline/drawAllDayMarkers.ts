import type * as d3 from 'd3'

import type { AllDayMarkerGroup } from './allDayMarkers'

import { markerGroupIcon, markerGroupTitle } from './allDayMarkers'
import { CLICK_MOVE_TOLERANCE_PX, drawItemIcon } from './drawItems'

export const ALL_DAY_GLYPH_SIZE = 18

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SvgParent = d3.Selection<any, unknown, null, undefined>

export interface DrawAllDayMarkersConfig {
  parent: SvgParent
  groups: AllDayMarkerGroup[]
  orientation: 'horizontal' | 'vertical'
  /** The lane's top (horizontal) or the column's centre (vertical). */
  cross: number
  onHover?: (event: MouseEvent, group: AllDayMarkerGroup) => void
  onLeave?: () => void
  onClick: (group: AllDayMarkerGroup) => void
}

/**
 * All-day markers: one glyph just after the start of each date (to the right of the day line when
 * time runs across, below it when time runs down), with a count when several share it.
 */
export const drawAllDayMarkers = ({
  parent,
  groups,
  orientation,
  cross,
  onHover,
  onLeave,
  onClick,
}: DrawAllDayMarkersConfig): void => {
  const half = ALL_DAY_GLYPH_SIZE / 2
  for (const group of groups) {
    const [cx, cy] =
      orientation === 'horizontal' ? [group.pos + half + 2, cross + half] : [cross, group.pos + half + 2]
    const glyph = drawItemIcon(parent, markerGroupIcon(group), cx, cy, ALL_DAY_GLYPH_SIZE, {
      cursor: 'pointer',
      pointerEvents: 'all',
    })
    if (!glyph) continue
    glyph.attr('class', 'all-day-marker').attr('role', 'link').attr('aria-label', markerGroupTitle(group))
    glyph.append('title').text(group.markers.map((m) => m.label).join('\n'))

    let downX = 0
    let downY = 0
    glyph
      .on('pointerdown', (event: PointerEvent) => {
        downX = event.clientX
        downY = event.clientY
      })
      .on('click', (event: MouseEvent) => {
        if (Math.hypot(event.clientX - downX, event.clientY - downY) > CLICK_MOVE_TOLERANCE_PX) return
        event.preventDefault()
        event.stopPropagation()
        onClick(group)
      })
    if (onHover) glyph.on('mouseenter', (event: MouseEvent) => onHover(event, group))
    if (onLeave) glyph.on('mouseleave', onLeave)

    if (group.markers.length > 1) {
      parent
        .append('text')
        .attr('x', cx + half)
        .attr('y', cy - half + 2)
        .attr('dominant-baseline', 'hanging')
        .attr('font-size', '0.6rem')
        .attr('font-weight', '700')
        .attr('fill', 'currentColor')
        .attr('pointer-events', 'none')
        .text(group.markers.length)
    }
  }
}
