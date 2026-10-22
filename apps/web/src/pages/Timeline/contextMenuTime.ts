import type { Orientation } from './types'

import { HORIZONTAL_MARGIN, VERTICAL_MARGIN } from './useTimelineZoom'

export interface PointerPosition {
  clientX: number
  clientY: number
}

export interface ContainerOrigin {
  left: number
  top: number
}

/**
 * The pointer's pixel offset along the time axis, in the coordinates the chart's
 * time scale speaks: y inside the plot area in vertical mode, x in horizontal.
 * Time flows down the chart in one orientation and across it in the other, so
 * which client coordinate matters — and which margin to subtract — flips too.
 */
export const pointerOffset = (
  point: PointerPosition,
  origin: ContainerOrigin,
  orientation: Orientation,
): number =>
  orientation === 'horizontal'
    ? point.clientX - origin.left - HORIZONTAL_MARGIN.left
    : point.clientY - origin.top - VERTICAL_MARGIN.top

/** Just the part of a d3 time scale this conversion needs. */
export interface InvertibleScale {
  invert: (value: number) => Date
  range: () => number[]
}

/**
 * Time-axis pixel offset → the moment under the pointer. Clamped to the scale's
 * range so a right-click in the axis gutter picks the nearest visible moment
 * instead of extrapolating hours off-screen.
 */
export const timeAtOffset = (offset: number, scale: InvertibleScale): Date => {
  const range = scale.range()
  const lo = range[0] ?? 0
  const hi = range[range.length - 1] ?? 0
  const min = Math.min(lo, hi)
  const max = Math.max(lo, hi)
  return scale.invert(Math.min(Math.max(offset, min), max))
}
