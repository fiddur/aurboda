import { describe, expect, test } from 'vitest'

import {
  type FlaggedWindow,
  flaggedDays,
  flaggedExclusion,
  inFlaggedWindow,
  withoutFlagged,
} from './flagged-windows.ts'

const window = (start: string, end: string): FlaggedWindow => ({
  activity_id: 'a1',
  activity_type: 'gathering',
  end: new Date(end),
  start: new Date(start),
})

const gathering = window('2026-05-01T00:00:00Z', '2026-05-03T12:00:00Z')
const ms = (iso: string) => new Date(iso).getTime()

describe('inFlaggedWindow', () => {
  test('the window is half-open', () => {
    expect(inFlaggedWindow([gathering], ms('2026-05-01T00:00:00Z'))).toBe(true)
    expect(inFlaggedWindow([gathering], ms('2026-05-03T12:00:00Z'))).toBe(false)
    expect(inFlaggedWindow([], ms('2026-05-02T00:00:00Z'))).toBe(false)
  })
})

describe('withoutFlagged', () => {
  test('keeps the items outside the windows and counts the rest', () => {
    const items = ['2026-04-30T23:00:00Z', '2026-05-02T08:00:00Z', '2026-05-04T08:00:00Z']
    expect(withoutFlagged(items, ms, [gathering])).toEqual({
      excluded: 1,
      kept: ['2026-04-30T23:00:00Z', '2026-05-04T08:00:00Z'],
    })
  })
})

describe('flaggedDays', () => {
  test('every day a window overlaps, in the timezone', () => {
    expect([...flaggedDays([gathering])]).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
    expect([...flaggedDays([gathering], 'America/New_York')]).toEqual([
      '2026-04-30',
      '2026-05-01',
      '2026-05-02',
      '2026-05-03',
    ])
  })

  test('a window ending at midnight does not reach the next day', () => {
    expect([...flaggedDays([window('2026-05-01T00:00:00Z', '2026-05-02T00:00:00Z')])]).toEqual(['2026-05-01'])
  })
})

describe('flaggedExclusion', () => {
  test('nothing without windows', () => {
    expect(flaggedExclusion([], { excluded_points: 0 })).toEqual({})
  })

  test('lists the windows with the counts', () => {
    expect(flaggedExclusion([gathering], { excluded_points: 4 })).toEqual({
      flagged_exclusion: {
        excluded_points: 4,
        windows: [
          {
            activity_id: 'a1',
            activity_type: 'gathering',
            end_time: '2026-05-03T12:00:00.000Z',
            start_time: '2026-05-01T00:00:00.000Z',
          },
        ],
      },
    })
  })
})
