import { describe, expect, test, vi } from 'vitest'

import type { PlaceVisit } from '../locations.ts'

import {
  attributeNights,
  canonicalPlace,
  type CanonicalVisit,
  getPlacesSummary,
  mergeVisits,
  type PlacesSummaryDeps,
} from './places-summary.ts'

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

const at = (
  place: string | null,
  start: string,
  end: string,
  key = place ?? '~Somewhere',
): CanonicalVisit => ({
  end_time: new Date(end),
  key,
  place,
  start_time: new Date(start),
})

const deps = (visits: PlaceVisit[], named = ['Home', 'Office', 'Hökås', 'Lönnåsen']): PlacesSummaryDeps => ({
  getNamedLocations: vi.fn().mockResolvedValue(named.map((name) => ({ name }))),
  getPlaceVisits: vi.fn().mockResolvedValue(visits),
})

const stockholm = 'Europe/Stockholm'

describe('canonicalPlace', () => {
  const named = new Map([['hökås', 'Hökås']])

  test('a named visit is its named location', () => {
    expect(canonicalPlace(visit('Hökås', '2026-10-01T00:00:00Z', '2026-10-01T01:00:00Z'), named)).toBe(
      'Hökås',
    )
  })

  test('an OwnTracks region named like a named location is that location, in its spelling', () => {
    expect(
      canonicalPlace(visit(' HÖKÅS ', '2026-10-01T00:00:00Z', '2026-10-01T01:00:00Z', 'owntracks'), named),
    ).toBe('Hökås')
  })

  test('other regions, detected and unknown places are elsewhere', () => {
    const elsewhere = (name: string, source: PlaceVisit['source']) =>
      canonicalPlace(visit(name, '2026-10-01T00:00:00Z', '2026-10-01T01:00:00Z', source), named)
    expect(elsewhere('Gym', 'owntracks')).toBeNull()
    expect(elsewhere('Hökås', 'detected')).toBeNull()
    expect(elsewhere('Somewhere', 'unknown')).toBeNull()
  })
})

describe('mergeVisits', () => {
  test('joins consecutive fragments of one place, in time order', () => {
    expect(
      mergeVisits([
        at('Home', '2026-10-01T12:00:00Z', '2026-10-01T14:00:00Z'),
        at('Home', '2026-10-01T08:00:00Z', '2026-10-01T10:00:00Z'),
        at('Home', '2026-10-01T10:05:00Z', '2026-10-01T11:00:00Z'),
        at(null, '2026-10-01T15:00:00Z', '2026-10-01T16:00:00Z', '~Gym'),
        at(null, '2026-10-01T16:10:00Z', '2026-10-01T17:00:00Z', '~Café'),
        at('Home', '2026-10-01T18:00:00Z', '2026-10-01T20:00:00Z'),
      ]),
    ).toEqual([
      at('Home', '2026-10-01T08:00:00Z', '2026-10-01T14:00:00Z'),
      at(null, '2026-10-01T15:00:00Z', '2026-10-01T16:00:00Z', '~Gym'),
      at(null, '2026-10-01T16:10:00Z', '2026-10-01T17:00:00Z', '~Café'),
      at('Home', '2026-10-01T18:00:00Z', '2026-10-01T20:00:00Z'),
    ])
  })

  test('keeps visits to one place apart when more than 36 hours separate them', () => {
    const visits = [
      at('Home', '2026-10-01T08:00:00Z', '2026-10-01T10:00:00Z'),
      at('Home', '2026-10-02T22:01:00Z', '2026-10-02T23:00:00Z'),
    ]
    expect(mergeVisits(visits)).toEqual(visits)
  })
})

describe('attributeNights', () => {
  const oneNight = {
    end: new Date('2026-10-12T21:59:59Z'),
    start: new Date('2026-10-11T22:00:00Z'),
    tz: stockholm,
  }
  const place = (visits: CanonicalVisit[]) => attributeNights(visits, oneNight)[0]?.place

  test('the night of each evening date in range, in the time zone', () => {
    const october = {
      end: new Date('2026-10-31T22:59:59.999Z'),
      start: new Date('2026-09-30T22:00:00Z'),
      tz: stockholm,
    }
    const nights = attributeNights([], october)
    expect(nights).toHaveLength(31)
    expect(nights[0]?.date).toBe('2026-10-01')
    expect(nights.at(-1)?.date).toBe('2026-10-31')
  })

  test('the place covering 03:00 the next morning', () => {
    expect(place([at('Cabin', '2026-10-12T15:00:00Z', '2026-10-13T08:00:00Z')])).toEqual({
      kind: 'named',
      name: 'Cabin',
    })
  })

  test('a gap between two visits to the same place counts as being there', () => {
    expect(
      place([
        at('Hökås', '2026-10-12T04:00:00Z', '2026-10-12T06:00:00Z'),
        at('Hökås', '2026-10-13T09:30:00Z', '2026-10-13T12:00:00Z'),
      ]),
    ).toEqual({ kind: 'named', name: 'Hökås' })
  })

  test('a gap longer than 36 hours is not bridged', () => {
    expect(
      place([
        at('Hökås', '2026-10-11T04:00:00Z', '2026-10-11T23:00:00Z'),
        at('Hökås', '2026-10-13T11:01:00Z', '2026-10-13T12:00:00Z'),
      ]),
    ).toEqual({ kind: 'no_data' })
  })

  test('a phone at rest stays at the last place for up to 18 hours', () => {
    expect(
      place([
        at('Hökås', '2026-10-12T06:00:00Z', '2026-10-12T13:14:00Z'),
        at('Lönnåsen', '2026-10-13T09:30:00Z', '2026-10-13T12:00:00Z'),
      ]),
    ).toEqual({ kind: 'named', name: 'Hökås' })
  })

  test('no data when the last visit ended longer ago and the next is elsewhere', () => {
    expect(
      place([
        at('Hökås', '2026-10-12T04:00:00Z', '2026-10-12T06:59:00Z'),
        at('Lönnåsen', '2026-10-13T09:30:00Z', '2026-10-13T12:00:00Z'),
      ]),
    ).toEqual({ kind: 'no_data' })
    expect(place([])).toEqual({ kind: 'no_data' })
  })

  test('elsewhere when the place is not a named location', () => {
    expect(place([at(null, '2026-10-12T18:00:00Z', '2026-10-13T08:00:00Z', '~Hotel')])).toEqual({
      kind: 'elsewhere',
    })
  })

  test('probes 03:00 local time on the night the clocks go back', () => {
    const dstNight = {
      end: new Date('2026-10-24T21:59:59Z'),
      start: new Date('2026-10-23T22:00:00Z'),
      tz: stockholm,
    }
    expect(
      attributeNights(
        [
          at('Cabin', '2026-10-24T08:00:00Z', '2026-10-25T01:30:00Z'),
          at('Home', '2026-10-25T01:45:00Z', '2026-10-25T09:00:00Z'),
        ],
        dstNight,
      ),
    ).toEqual([{ date: '2026-10-24', place: { kind: 'named', name: 'Home' } }])
  })
})

describe('getPlacesSummary', () => {
  const week = {
    end: new Date('2026-10-07T23:59:59.999Z'),
    start: new Date('2026-10-01T00:00:00Z'),
    tz: 'UTC',
  }

  const visits = [
    visit('Home', '2026-09-29T18:00:00Z', '2026-10-02T08:00:00Z'),
    visit('Office', '2026-10-02T09:00:00Z', '2026-10-02T12:00:00Z'),
    visit('Office', '2026-10-02T12:05:00Z', '2026-10-02T17:00:00Z', 'owntracks'),
    visit('Cabin', '2026-10-02T18:00:00Z', '2026-10-04T09:00:00Z', 'detected'),
    visit('Home', '2026-10-04T12:00:00Z', '2026-10-05T16:00:00Z'),
    visit('Somewhere', '2026-10-05T18:00:00Z', '2026-10-06T08:00:00Z', 'unknown'),
    visit('Home', '2026-10-06T09:00:00Z', '2026-10-06T10:00:00Z'),
  ]

  test('attributes each night, counts the named places and their merged visits', async () => {
    const d = deps(visits)

    const summary = await getPlacesSummary('u', { ...week, homeName: 'home' }, d)

    expect(summary).toEqual({
      distinct_places: 2,
      nights_away: 3,
      nights_by_place: [{ name: 'Home', nights: 3 }],
      nights_elsewhere: 3,
      nights_home: 3,
      nights_no_data: 1,
      places: [
        { hours: 61, name: 'Home', nights: 3, visits: 3 },
        { hours: 8, name: 'Office', nights: 0, visits: 1 },
      ],
      visits: 4,
    })
    expect(
      summary.nights_by_place.reduce((n, p) => n + p.nights, 0) +
        summary.nights_elsewhere +
        summary.nights_no_data,
    ).toBe(7)
    expect(d.getPlaceVisits).toHaveBeenCalledWith(
      'u',
      new Date('2026-09-29T00:00:00Z'),
      new Date('2026-10-09T23:59:59.999Z'),
    )
  })

  test('the night at rest at a place reached again through its OwnTracks region (#1559)', async () => {
    const summary = await getPlacesSummary(
      'u',
      { end: new Date('2026-10-12T21:59:59Z'), start: new Date('2026-10-11T22:00:00Z'), tz: stockholm },
      deps([
        visit('Hökås', '2026-10-12T06:00:00Z', '2026-10-12T13:14:00Z'),
        visit('HÖKÅS', '2026-10-13T09:30:00Z', '2026-10-13T12:00:00Z', 'owntracks'),
      ]),
    )

    expect(summary).toMatchObject({
      distinct_places: 1,
      nights_by_place: [{ name: 'Hökås', nights: 1 }],
      nights_no_data: 0,
      visits: 1,
    })
  })

  test('home defaults to Home; every other night with a place is away', async () => {
    const summary = await getPlacesSummary('u', week, deps(visits))

    expect(summary).toMatchObject({ nights_away: 3, nights_home: 3 })
  })

  test('lists the five named places with most nights, then hours', async () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F']
    const summary = await getPlacesSummary(
      'u',
      week,
      deps(
        [
          visit('A', '2026-10-01T20:00:00Z', '2026-10-01T21:00:00Z'),
          ...names
            .slice(0, 5)
            .map((name, i) =>
              visit(
                name,
                `2026-10-0${i + 2}T09:00:00Z`,
                `2026-10-0${i + 2}T${String(10 + i).padStart(2, '0')}:00:00Z`,
              ),
            ),
          visit('F', '2026-10-07T22:00:00Z', '2026-10-07T23:30:00Z'),
        ],
        names,
      ),
    )

    expect(summary.places.map((p) => [p.name, p.nights])).toEqual([
      ['A', 2],
      ['E', 1],
      ['D', 1],
      ['C', 1],
      ['B', 1],
    ])
    expect(summary.distinct_places).toBe(6)
  })

  test('every night has no data without visits', async () => {
    expect(await getPlacesSummary('u', week, deps([]))).toEqual({
      distinct_places: 0,
      nights_away: 0,
      nights_by_place: [],
      nights_elsewhere: 0,
      nights_home: 0,
      nights_no_data: 7,
      places: [],
      visits: 0,
    })
  })
})
