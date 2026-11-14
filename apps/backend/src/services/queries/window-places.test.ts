import { describe, expect, test, vi } from 'vitest'

import type { PlaceVisit } from '../locations.ts'

import { placeOfWindow, placesOfWindows, type WindowPlacesDeps } from './window-places.ts'

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

const win = (start: string, end: string) => ({ end: new Date(end), start: new Date(start) })

const named = new Map([
  ['home', 'Home'],
  ['studio', 'Studio'],
])
const SIX_HOURS = 6 * 3_600_000

describe('placeOfWindow', () => {
  test('the named place overlapping the window longest wins', () => {
    const visits = [
      visit('Home', '2026-10-01T07:00:00Z', '2026-10-01T07:20:00Z'),
      visit('Studio', '2026-10-01T07:25:00Z', '2026-10-01T09:00:00Z'),
    ]
    expect(placeOfWindow(visits, named, win('2026-10-01T07:10:00Z', '2026-10-01T08:00:00Z'), SIX_HOURS)).toBe(
      'Studio',
    )
  })

  test('overlap is summed over the visits to one place', () => {
    const visits = [
      visit('Home', '2026-10-01T07:00:00Z', '2026-10-01T07:20:00Z'),
      visit('Studio', '2026-10-01T07:20:00Z', '2026-10-01T07:45:00Z'),
      visit('Home', '2026-10-01T07:45:00Z', '2026-10-01T08:10:00Z'),
    ]
    expect(placeOfWindow(visits, named, win('2026-10-01T07:00:00Z', '2026-10-01T08:00:00Z'), SIX_HOURS)).toBe(
      'Home',
    )
  })

  test('unnamed visits do not count, and a region named like a named location is that place', () => {
    const visits = [
      visit('Somewhere', '2026-10-01T07:00:00Z', '2026-10-01T07:50:00Z', 'unknown'),
      visit('studio', '2026-10-01T07:50:00Z', '2026-10-01T08:00:00Z', 'owntracks'),
    ]
    expect(placeOfWindow(visits, named, win('2026-10-01T07:00:00Z', '2026-10-01T08:00:00Z'), SIX_HOURS)).toBe(
      'Studio',
    )
  })

  test('a window with only unnamed visits has no place, even with a named place before it', () => {
    const visits = [
      visit('Home', '2026-10-01T05:00:00Z', '2026-10-01T06:00:00Z'),
      visit('Somewhere', '2026-10-01T07:00:00Z', '2026-10-01T07:50:00Z', 'unknown'),
    ]
    expect(
      placeOfWindow(visits, named, win('2026-10-01T07:00:00Z', '2026-10-01T08:00:00Z'), SIX_HOURS),
    ).toBeNull()
  })

  test('a window without a fix takes the last-known place within the lookback', () => {
    const visits = [
      visit('Home', '2026-10-01T05:00:00Z', '2026-10-01T06:00:00Z'),
      visit('Studio', '2026-10-01T15:00:00Z', '2026-10-01T16:00:00Z'),
    ]
    expect(placeOfWindow(visits, named, win('2026-10-01T10:00:00Z', '2026-10-01T10:20:00Z'), SIX_HOURS)).toBe(
      'Home',
    )
    expect(
      placeOfWindow(visits, named, win('2026-10-01T12:30:00Z', '2026-10-01T12:50:00Z'), SIX_HOURS),
    ).toBeNull()
  })

  test('a window with no visits at all has no place', () => {
    expect(
      placeOfWindow([], named, win('2026-10-01T10:00:00Z', '2026-10-01T10:20:00Z'), SIX_HOURS),
    ).toBeNull()
  })
})

describe('placesOfWindows', () => {
  const deps = (visits: PlaceVisit[]): WindowPlacesDeps => ({
    getNamedLocations: vi.fn().mockResolvedValue([{ name: 'Home' }, { name: 'Studio' }]),
    getPlaceVisits: vi.fn().mockResolvedValue(visits),
  })

  test('fetches visits once over the windows, widened back by the lookback', async () => {
    const d = deps([
      visit('Studio', '2026-10-03T07:00:00Z', '2026-10-03T08:00:00Z'),
      visit('Home', '2026-10-01T05:00:00Z', '2026-10-01T06:00:00Z'),
    ])
    const places = await placesOfWindows(
      'u',
      [
        win('2026-10-03T07:10:00Z', '2026-10-03T07:40:00Z'),
        win('2026-10-01T08:00:00Z', '2026-10-01T08:30:00Z'),
      ],
      d,
      6,
    )
    expect(places).toEqual(['Studio', 'Home'])
    expect(d.getPlaceVisits).toHaveBeenCalledTimes(1)
    expect(d.getPlaceVisits).toHaveBeenCalledWith(
      'u',
      new Date('2026-10-01T02:00:00Z'),
      new Date('2026-10-03T07:40:00Z'),
    )
  })

  test('no windows read nothing', async () => {
    const d = deps([])
    expect(await placesOfWindows('u', [], d)).toEqual([])
    expect(d.getPlaceVisits).not.toHaveBeenCalled()
  })
})
