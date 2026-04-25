import { describe, expect, test } from 'vitest'

import type { PlaceVisit } from '../locations.ts'

import {
  detectOvernightStays,
  getLocationSummary,
  queryOvernightStays,
  summarizeVisits,
} from './location-stays.ts'

const visit = (overrides: Partial<PlaceVisit>): PlaceVisit => ({
  duration_minutes:
    overrides.end_time && overrides.start_time
      ? Math.round((overrides.end_time.getTime() - overrides.start_time.getTime()) / 60000)
      : 0,
  end_time: new Date(),
  lat: 0,
  lon: 0,
  name: 'Cabin',
  source: 'named',
  start_time: new Date(),
  ...overrides,
})

const TZ = 'Europe/Stockholm'

describe('detectOvernightStays', () => {
  test('counts a visit that spans evening to next morning as one night', () => {
    // Stockholm summer (CEST, UTC+2): 18:00 local = 16:00 UTC; 10:00 local = 08:00 UTC.
    const v = visit({
      end_time: new Date('2025-06-21T08:30:00Z'), // 10:30 local
      start_time: new Date('2025-06-20T16:00:00Z'), // 18:00 local
    })
    const stays = detectOvernightStays([v], TZ)
    expect(stays).toHaveLength(1)
    expect(stays[0].overnight_date).toBe('2025-06-20')
    expect(stays[0].duration_hours).toBeCloseTo(16.5, 1)
  })

  test('multi-night visit yields one entry per crossed night', () => {
    const v = visit({
      end_time: new Date('2025-06-22T09:00:00Z'), // Sun 11:00 local
      start_time: new Date('2025-06-20T15:30:00Z'), // Fri 17:30 local
    })
    const stays = detectOvernightStays([v], TZ)
    expect(stays.map((s) => s.overnight_date)).toEqual(['2025-06-20', '2025-06-21'])
  })

  test('does not count a daytime visit (no overnight)', () => {
    const v = visit({
      end_time: new Date('2025-06-20T14:00:00Z'),
      start_time: new Date('2025-06-20T08:00:00Z'),
    })
    expect(detectOvernightStays([v], TZ)).toEqual([])
  })

  test('does not count an evening-only visit that leaves before midnight', () => {
    const v = visit({
      end_time: new Date('2025-06-20T20:00:00Z'), // 22:00 local
      start_time: new Date('2025-06-20T16:00:00Z'), // 18:00 local
    })
    expect(detectOvernightStays([v], TZ)).toEqual([])
  })

  test('counts overnight even when departure is before morning threshold (still present at midnight)', () => {
    // Person was continuously at the location from 18:00 D through 07:30 D+1 — the
    // morning-window check is overlap, not "still present at 10:00".
    const v = visit({
      end_time: new Date('2025-06-21T05:30:00Z'), // 07:30 local
      start_time: new Date('2025-06-20T16:00:00Z'),
    })
    const stays = detectOvernightStays([v], TZ)
    expect(stays).toHaveLength(1)
    expect(stays[0].overnight_date).toBe('2025-06-20')
  })

  test('respects custom thresholds', () => {
    const v = visit({
      end_time: new Date('2025-06-21T05:30:00Z'), // 07:30 local
      start_time: new Date('2025-06-20T18:30:00Z'), // 20:30 local
    })
    const stays = detectOvernightStays([v], TZ, {
      arrivalBefore: '08:00',
      departureAfter: '20:00',
    })
    expect(stays).toHaveLength(1)
    expect(stays[0].overnight_date).toBe('2025-06-20')
  })
})

describe('summarizeVisits', () => {
  const visits: PlaceVisit[] = [
    visit({
      duration_minutes: 990, // 16.5h
      end_time: new Date('2025-06-21T08:30:00Z'),
      start_time: new Date('2025-06-20T16:00:00Z'),
    }),
    visit({
      duration_minutes: 360, // 6h, no overnight
      end_time: new Date('2025-06-25T20:00:00Z'),
      start_time: new Date('2025-06-25T14:00:00Z'),
    }),
  ]

  test('totals are computed across visits', () => {
    const result = summarizeVisits(visits, { tz: TZ })
    expect(result.total_visits).toBe(2)
    expect(result.total_nights).toBe(1)
    expect(result.total_hours).toBeCloseTo(22.5, 1)
    expect(result.breakdown).toBeUndefined()
  })

  test('breakdown groups by day', () => {
    const result = summarizeVisits(visits, { groupBy: 'day', tz: TZ })
    expect(result.breakdown).toHaveLength(2)
    const byDay = Object.fromEntries(result.breakdown!.map((b) => [b.period, b]))
    expect(byDay['2025-06-20']).toMatchObject({ nights: 1, visits: 1 })
    expect(byDay['2025-06-25']).toMatchObject({ nights: 0, visits: 1 })
  })

  test('breakdown groups by month', () => {
    const result = summarizeVisits(visits, { groupBy: 'month', tz: TZ })
    expect(result.breakdown).toHaveLength(1)
    expect(result.breakdown![0]).toMatchObject({
      nights: 1,
      period: '2025-06',
      visits: 2,
    })
  })
})

describe('queryOvernightStays', () => {
  const fixedVisits: PlaceVisit[] = [
    visit({
      end_time: new Date('2025-06-21T08:30:00Z'),
      name: 'Cabin',
      start_time: new Date('2025-06-20T16:00:00Z'),
    }),
    visit({
      end_time: new Date('2025-06-22T09:00:00Z'),
      name: 'Other',
      source: 'named',
      start_time: new Date('2025-06-21T16:00:00Z'),
    }),
  ]

  test('filters by name and returns only stays in range', async () => {
    const deps = { getPlaceVisits: async () => fixedVisits }
    const result = await queryOvernightStays(
      'user',
      {
        end: new Date('2025-06-30T22:00:00Z'),
        locationName: 'cabin', // case-insensitive
        start: new Date('2025-06-19T22:00:00Z'),
        tz: TZ,
      },
      deps,
    )
    expect(result.total_nights).toBe(1)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].overnight_date).toBe('2025-06-20')
  })

  test('drops stays whose overnight_date is outside the requested window', async () => {
    const deps = { getPlaceVisits: async () => fixedVisits }
    const result = await queryOvernightStays(
      'user',
      {
        end: new Date('2025-06-19T22:00:00Z'), // window ends before stay
        locationName: 'Cabin',
        start: new Date('2025-06-18T22:00:00Z'),
        tz: TZ,
      },
      deps,
    )
    expect(result.total_nights).toBe(0)
  })
})

describe('getLocationSummary', () => {
  test('aggregates visits filtered by name', async () => {
    const visits = [
      visit({
        end_time: new Date('2025-06-21T08:30:00Z'),
        name: 'Cabin',
        start_time: new Date('2025-06-20T16:00:00Z'),
      }),
      visit({
        end_time: new Date('2025-06-21T15:00:00Z'),
        name: 'Office',
        start_time: new Date('2025-06-21T07:00:00Z'),
      }),
    ]
    const deps = { getPlaceVisits: async () => visits }
    const result = await getLocationSummary(
      'user',
      {
        end: new Date('2025-06-30T22:00:00Z'),
        locationName: 'Cabin',
        start: new Date('2025-06-19T22:00:00Z'),
        tz: TZ,
      },
      deps,
    )
    expect(result.total_visits).toBe(1)
    expect(result.total_nights).toBe(1)
  })
})
