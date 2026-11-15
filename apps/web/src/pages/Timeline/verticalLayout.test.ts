import { describe, expect, it } from 'vitest'

import {
  layoutVerticalTracks,
  METRICS_TRACK_MIN_WIDTH,
  MUSIC_TRACK_WIDTH,
  verticalTrackSpecs,
} from './verticalLayout'

describe('verticalTrackSpecs', () => {
  it('orders the tracks Activity, Location, Music, Metrics, Comments', () => {
    const specs = verticalTrackSpecs(['Comments', 'Location', 'Activity'], true, true)
    expect(specs.map((s) => s.id)).toEqual(['Activity', 'Location', 'Music', 'Metrics', 'Comments'])
  })

  it('leaves out Music and Metrics when they are not shown', () => {
    expect(verticalTrackSpecs(['Activity', 'Location'], false, false).map((s) => s.id)).toEqual([
      'Activity',
      'Location',
    ])
  })

  it('keeps Metrics when no item column has anything', () => {
    expect(verticalTrackSpecs([], false, true).map((s) => s.id)).toEqual(['Metrics'])
  })
})

describe('layoutVerticalTracks', () => {
  it('gives Music its fixed width and shares the rest equally', () => {
    const slots = layoutVerticalTracks(verticalTrackSpecs(['Activity', 'Location'], true, true), 640)
    const share = (640 - MUSIC_TRACK_WIDTH) / 3
    expect(slots).toEqual([
      { id: 'Activity', width: share, x: 0 },
      { id: 'Location', width: share, x: share },
      { id: 'Music', width: MUSIC_TRACK_WIDTH, x: 2 * share },
      { id: 'Metrics', width: share, x: 2 * share + MUSIC_TRACK_WIDTH },
    ])
  })

  it('keeps Metrics at its minimum width on a narrow chart', () => {
    const specs = verticalTrackSpecs(['Activity', 'Location', 'Comments'], true, true)
    const slots = layoutVerticalTracks(specs, 300)
    const metrics = slots.find((s) => s.id === 'Metrics')!
    expect(metrics.width).toBe(METRICS_TRACK_MIN_WIDTH)
    const rest = (300 - MUSIC_TRACK_WIDTH - METRICS_TRACK_MIN_WIDTH) / 3
    expect(slots.find((s) => s.id === 'Activity')!.width).toBeCloseTo(rest)
    const last = slots.at(-1)!
    expect(last.x + last.width).toBeCloseTo(300)
  })

  it('tiles the chart width without gaps or overlap', () => {
    const slots = layoutVerticalTracks(
      verticalTrackSpecs(['Activity', 'Location', 'Comments'], true, true),
      1000,
    )
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]!.x).toBeCloseTo(slots[i - 1]!.x + slots[i - 1]!.width)
    }
    expect(slots.at(-1)!.x + slots.at(-1)!.width).toBeCloseTo(1000)
  })

  it('returns no slots for no tracks', () => {
    expect(layoutVerticalTracks([], 500)).toEqual([])
  })
})
