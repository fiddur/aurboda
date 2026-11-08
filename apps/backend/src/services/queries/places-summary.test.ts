import { describe, expect, test, vi } from 'vitest'

import type { PlaceVisit } from '../locations.ts'

import { getPlacesSummary, type PlacesSummaryDeps } from './places-summary.ts'

const visit = (
  name: string,
  start: string,
  end: string,
  source: PlaceVisit['source'] = 'named',
): PlaceVisit => {
  const start_time = new Date(start)
  const end_time = new Date(end)
  return {
    duration_minutes: (end_time.getTime() - start_time.getTime()) / 60000,
    end_time,
    lat: 0,
    lon: 0,
    name,
    source,
    start_time,
  }
}

const deps = (visits: PlaceVisit[]): PlacesSummaryDeps => ({
  getPlaceVisits: vi.fn().mockResolvedValue(visits),
})

const range = {
  end: new Date('2026-10-07T23:59:59.999Z'),
  start: new Date('2026-10-01T00:00:00Z'),
  tz: 'UTC',
}

const week = [
  visit('Home', '2026-10-01T00:00:00Z', '2026-10-04T08:00:00Z'),
  visit('Office', '2026-10-04T09:00:00Z', '2026-10-04T17:00:00Z'),
  visit('Cabin', '2026-10-04T18:00:00Z', '2026-10-05T09:00:00Z', 'detected'),
  visit('Home', '2026-10-05T12:00:00Z', '2026-10-05T16:00:00Z'),
  visit('Office', '2026-10-06T09:00:00Z', '2026-10-06T17:00:00Z'),
  visit('Somewhere', '2026-10-06T18:00:00Z', '2026-10-07T08:00:00Z', 'unknown'),
  visit('', '2026-10-07T09:00:00Z', '2026-10-07T10:00:00Z', 'detected'),
]

describe('getPlacesSummary', () => {
  test('counts nights at home and away, places and visits', async () => {
    const d = deps(week)

    const summary = await getPlacesSummary('u', { ...range, homeName: 'Home' }, d)

    expect(summary).toEqual({
      distinct_places: 3,
      nights_away: 1,
      nights_home: 3,
      places: [
        { hours: 84, name: 'Home', visits: 2 },
        { hours: 16, name: 'Office', visits: 2 },
        { hours: 15, name: 'Cabin', visits: 1 },
      ],
      visits: 5,
    })
    expect(d.getPlaceVisits).toHaveBeenCalledWith(
      'u',
      new Date('2026-09-30T00:00:00Z'),
      new Date('2026-10-08T23:59:59.999Z'),
    )
  })

  test('matches the home place case-insensitively, defaulting to Home', async () => {
    const summary = await getPlacesSummary(
      'u',
      range,
      deps([visit('HOME', '2026-10-01T18:00:00Z', '2026-10-03T08:00:00Z')]),
    )

    expect(summary).toMatchObject({ nights_away: 0, nights_home: 2 })
  })

  test('counts the nights of another place as home when it is the configured home', async () => {
    const summary = await getPlacesSummary('u', { ...range, homeName: 'cabin' }, deps(week))

    expect(summary).toMatchObject({ nights_away: 3, nights_home: 1 })
  })

  test('keeps a night by its evening date, also when the stay runs past the range', async () => {
    const summary = await getPlacesSummary(
      'u',
      range,
      deps([
        visit('Home', '2026-09-29T18:00:00Z', '2026-10-01T08:00:00Z'),
        visit('Hotel', '2026-10-02T18:00:00Z', '2026-10-03T08:00:00Z'),
        visit('Home', '2026-10-05T18:00:00Z', '2026-10-09T08:00:00Z'),
      ]),
    )

    expect(summary).toMatchObject({ nights_away: 1, nights_home: 3, visits: 3 })
  })

  test('is empty without visits', async () => {
    expect(await getPlacesSummary('u', range, deps([]))).toEqual({
      distinct_places: 0,
      nights_away: 0,
      nights_home: 0,
      places: [],
      visits: 0,
    })
  })
})
