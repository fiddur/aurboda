import { topListFromApps, topListFromMedia, topListFromPlaces, windowDays } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { formatDistinct, formatItemCount, formatNumber, topListTitle, totalUnit } from './topListCard'

describe('topListTitle', () => {
  test('defaults per source and follows a configured title', () => {
    expect(topListTitle({ source: 'media_artist' })).toBe('Top artists')
    expect(topListTitle({ source: 'media_album' })).toBe('Top albums')
    expect(topListTitle({ source: 'media_track' })).toBe('Top tracks')
    expect(topListTitle({ source: 'screentime_app' })).toBe('Top apps')
    expect(topListTitle({ source: 'place' })).toBe('Top places')
    expect(topListTitle({ source: 'place', title: 'Where' })).toBe('Where')
  })
})

describe('formatting', () => {
  test('formats totals with grouping and one decimal at most', () => {
    expect(formatNumber(1760)).toBe('1,760')
    expect(formatNumber(4.87)).toBe('4.9')
    expect(totalUnit('plays')).toBe('plays')
    expect(totalUnit('hours')).toBe('h')
    expect(totalUnit('visits')).toBe('visits')
  })

  test('formats item counts in their unit', () => {
    expect(formatItemCount(120, 'plays')).toBe('120')
    expect(formatItemCount(60.5, 'hours')).toBe('60.5 h')
  })

  test('names the distinct count after the source', () => {
    expect(formatDistinct(506, 'media_artist')).toBe('506 artists')
    expect(formatDistinct(1, 'screentime_app')).toBe('1 app')
  })
})

describe('mapping the endpoints onto the card', () => {
  test('maps media plays', () => {
    expect(topListFromMedia({ distinct: 2, items: [{ name: 'Bach', plays: 3 }], total_plays: 4 })).toEqual({
      distinct: 2,
      items: [{ count: 3, name: 'Bach' }],
      per_day: null,
      total: 4,
      unit: 'plays',
    })
  })

  test('maps apps with hours per day', () => {
    const days = windowDays(new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'))
    expect(days).toBe(31)
    expect(
      topListFromApps(
        { distinct_apps: 1, items: [{ hours: 60.5, name: 'Firefox' }], total_hours: 151 },
        days,
      ),
    ).toEqual({
      distinct: 1,
      items: [{ count: 60.5, name: 'Firefox' }],
      per_day: 4.9,
      total: 151,
      unit: 'hours',
    })
  })

  test('maps places to their visits, most visits first, to the limit', () => {
    const summary = {
      distinct_places: 2,
      nights_away: 0,
      nights_by_place: [{ name: 'Gym', nights: 1 }],
      nights_elsewhere: 0,
      nights_home: 0,
      nights_no_data: 6,
      places: [
        { hours: 2, name: 'Gym', nights: 1, visits: 3 },
        { hours: 10, name: 'Home', nights: 0, visits: 5 },
      ],
      visits: 8,
    }
    expect(topListFromPlaces(summary, 1)).toEqual({
      distinct: 2,
      items: [{ count: 5, name: 'Home' }],
      per_day: null,
      total: 8,
      unit: 'visits',
    })
  })
})
