import { describe, expect, it } from 'vitest'

import { STAGE_COLORS } from '../charts/sleep-utils'
import { delta, formatDelta, stageBreakdown, stageStripSegments } from './lastSleep'

describe('stageStripSegments', () => {
  it('positions each stage as a percentage of the night', () => {
    const segments = stageStripSegments({
      end_time: '2026-09-25T04:00:00Z',
      stages: [
        { end_time: '2026-09-25T01:00:00Z', stage: 4, start_time: '2026-09-25T00:00:00Z' },
        { end_time: '2026-09-25T04:00:00Z', stage: 5, start_time: '2026-09-25T02:00:00Z' },
      ],
      start_time: '2026-09-25T00:00:00Z',
    })
    expect(segments.map(({ color, left, width }) => ({ color, left, width }))).toEqual([
      { color: STAGE_COLORS[4], left: 0, width: 25 },
      { color: STAGE_COLORS[5], left: 50, width: 50 },
    ])
    expect(segments[0].title).toMatch(/^Light /)
  })

  it('stretches the span to stages outside the session bounds', () => {
    const segments = stageStripSegments({
      end_time: '2026-09-25T01:00:00Z',
      stages: [{ end_time: '2026-09-25T02:00:00Z', stage: 6, start_time: '2026-09-25T00:00:00Z' }],
      start_time: '2026-09-25T00:00:00Z',
    })
    expect(segments[0]).toMatchObject({ left: 0, width: 100 })
  })

  it('is empty without stages', () => {
    expect(
      stageStripSegments({
        end_time: '2026-09-25T01:00:00Z',
        stages: [],
        start_time: '2026-09-25T00:00:00Z',
      }),
    ).toEqual([])
  })
})

describe('stageBreakdown', () => {
  it('orders deep, light, REM, awake', () => {
    expect(
      stageBreakdown({ awake: 5, deep: 60, light: 200, rem: 90 }).map((s) => [s.label, s.minutes]),
    ).toEqual([
      ['Deep', 60],
      ['Light', 200],
      ['REM', 90],
      ['Awake', 5],
    ])
  })

  it('is empty without minutes', () => {
    expect(stageBreakdown(undefined)).toEqual([])
  })
})

describe('delta', () => {
  it('rounds the difference and picks an arrow', () => {
    expect(delta(52, 48.4)).toEqual({ amount: 4, arrow: '↑' })
    expect(delta(44, 48.4)).toEqual({ amount: 4, arrow: '↓' })
    expect(delta(48, 48.4)).toEqual({ amount: 0, arrow: '→' })
  })

  it('is undefined when either side is missing', () => {
    expect(delta(undefined, 50)).toBeUndefined()
    expect(delta(50, undefined)).toBeUndefined()
  })

  it('formats', () => {
    expect(formatDelta({ amount: 4, arrow: '↑' })).toBe('↑4')
    expect(formatDelta({ amount: 0, arrow: '→' })).toBe('→')
  })
})
