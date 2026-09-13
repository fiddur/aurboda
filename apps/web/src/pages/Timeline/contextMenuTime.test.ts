import * as d3 from 'd3'
import { describe, expect, it } from 'vitest'

import { pointerOffset, timeAtOffset } from './contextMenuTime'
import { HORIZONTAL_MARGIN, VERTICAL_MARGIN } from './useTimelineZoom'

const origin = { left: 20, top: 50 }

describe('pointerOffset', () => {
  it('uses y minus the top margin in vertical mode (time flows down)', () => {
    const offset = pointerOffset({ clientX: 400, clientY: 250 }, origin, 'vertical')
    expect(offset).toBe(250 - origin.top - VERTICAL_MARGIN.top)
  })

  it('uses x minus the left margin in horizontal mode (time flows across)', () => {
    const offset = pointerOffset({ clientX: 400, clientY: 250 }, origin, 'horizontal')
    expect(offset).toBe(400 - origin.left - HORIZONTAL_MARGIN.left)
  })
})

describe('timeAtOffset', () => {
  const start = new Date('2026-09-13T00:00:00.000Z')
  const end = new Date('2026-09-14T00:00:00.000Z')
  const scale = d3.scaleTime().domain([start, end]).range([0, 480])

  it('inverts an offset into the moment under the pointer', () => {
    expect(timeAtOffset(0, scale).toISOString()).toBe('2026-09-13T00:00:00.000Z')
    expect(timeAtOffset(240, scale).toISOString()).toBe('2026-09-13T12:00:00.000Z')
    expect(timeAtOffset(480, scale).toISOString()).toBe('2026-09-14T00:00:00.000Z')
  })

  it('clamps to the scale range instead of extrapolating off-chart', () => {
    expect(timeAtOffset(-500, scale).toISOString()).toBe('2026-09-13T00:00:00.000Z')
    expect(timeAtOffset(5000, scale).toISOString()).toBe('2026-09-14T00:00:00.000Z')
  })

  it('works for both orientations end to end', () => {
    const vertical = timeAtOffset(pointerOffset({ clientX: 0, clientY: 290 }, origin, 'vertical'), scale)
    // 290 - 50 (top) - 30 (vertical top margin) = 210px → 10.5h into the day
    expect(vertical.toISOString()).toBe('2026-09-13T10:30:00.000Z')

    const horizontal = timeAtOffset(pointerOffset({ clientX: 320, clientY: 0 }, origin, 'horizontal'), scale)
    // 320 - 20 (left) - 60 (horizontal left margin) = 240px → midday
    expect(horizontal.toISOString()).toBe('2026-09-13T12:00:00.000Z')
  })
})
