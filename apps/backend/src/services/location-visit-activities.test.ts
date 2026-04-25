import { describe, expect, test, vi } from 'vitest'

import type { NamedLocation } from '../db/types.ts'
import type { PlaceVisit } from './locations.ts'

import {
  materializeForRange,
  materializeFromVisits,
  visitsToActivities,
} from './location-visit-activities.ts'

const nl = (overrides: Partial<NamedLocation>): NamedLocation => ({
  auto_create_activity: false,
  created_at: new Date(),
  id: 'nl-1',
  lat: 59.33,
  lon: 18.07,
  name: 'Office',
  radius: 200,
  updated_at: new Date(),
  ...overrides,
})

const visit = (overrides: Partial<PlaceVisit>): PlaceVisit => ({
  duration_minutes: 60,
  end_time: new Date('2026-04-19T11:00:00Z'),
  lat: 59.33,
  lon: 18.07,
  name: 'Office',
  source: 'named',
  start_time: new Date('2026-04-19T10:00:00Z'),
  ...overrides,
})

describe('visitsToActivities', () => {
  test('creates activity for visit to opted-in named location', () => {
    const named = [nl({ id: 'office-id', auto_create_activity: true })]
    const visits = [visit({ named_location_id: 'office-id' })]
    const activities = visitsToActivities(visits, named)
    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({
      activity_type: 'location_visit',
      data: { location_name: 'Office', lat: 59.33, lon: 18.07 },
      source: 'location-detection',
    })
  })

  test('deterministic external_id based on location id and start time', () => {
    const named = [nl({ id: 'office-id', auto_create_activity: true })]
    const startTime = new Date('2026-04-19T10:00:00Z')
    const visits = [visit({ named_location_id: 'office-id', start_time: startTime })]
    const activities = visitsToActivities(visits, named)
    expect(activities[0].external_id).toBe(`locvisit_office-id_${startTime.getTime()}`)
  })

  test('skips visits to non-opted-in locations', () => {
    const named = [nl({ id: 'office-id', auto_create_activity: false })]
    const visits = [visit({ named_location_id: 'office-id' })]
    expect(visitsToActivities(visits, named)).toEqual([])
  })

  test('skips visits whose named_location_id is not in the opted-in set', () => {
    const named = [nl({ id: 'office-id', auto_create_activity: true })]
    // Visit to a different named location that isn't opted in
    const visits = [visit({ named_location_id: 'home-id', name: 'Home' })]
    expect(visitsToActivities(visits, named)).toEqual([])
  })

  test('skips visits shorter than 10 minutes', () => {
    const named = [nl({ id: 'office-id', auto_create_activity: true })]
    const visits = [visit({ named_location_id: 'office-id', duration_minutes: 5 })]
    expect(visitsToActivities(visits, named)).toEqual([])
  })

  test('includes visits of exactly 10 minutes (boundary)', () => {
    const named = [nl({ id: 'office-id', auto_create_activity: true })]
    const visits = [visit({ named_location_id: 'office-id', duration_minutes: 10 })]
    expect(visitsToActivities(visits, named)).toHaveLength(1)
  })

  test('skips detected / owntracks / unknown visits even if "near" an opted-in location', () => {
    const named = [nl({ id: 'office-id', auto_create_activity: true })]
    const visits = [
      visit({ source: 'detected', named_location_id: undefined }),
      visit({ source: 'owntracks', named_location_id: undefined }),
      visit({ source: 'unknown', named_location_id: undefined }),
    ]
    expect(visitsToActivities(visits, named)).toEqual([])
  })

  test('returns empty when no named locations are opted in', () => {
    const named = [nl({ auto_create_activity: false })]
    const visits = [visit({ named_location_id: 'nl-1' })]
    expect(visitsToActivities(visits, named)).toEqual([])
  })
})

describe('materializeFromVisits', () => {
  test('upserts activities for opted-in named visits', async () => {
    const named = [nl({ id: 'nl-1', auto_create_activity: true })]
    const visits = [visit({ named_location_id: 'nl-1' })]
    const insertActivities = vi.fn().mockResolvedValue(undefined)
    const getNamedLocations = vi.fn().mockResolvedValue(named)

    const result = await materializeFromVisits('user', visits, { getNamedLocations, insertActivities })

    expect(result).toEqual({ upserted: 1 })
    expect(insertActivities).toHaveBeenCalledWith(
      'user',
      expect.arrayContaining([expect.objectContaining({ activity_type: 'location_visit' })]),
    )
  })

  test('short-circuits without fetching named locations when no named visits present', async () => {
    const visits = [visit({ source: 'detected', named_location_id: undefined })]
    const getNamedLocations = vi.fn()
    const insertActivities = vi.fn()

    const result = await materializeFromVisits('user', visits, { getNamedLocations, insertActivities })

    expect(result).toEqual({ upserted: 0 })
    expect(getNamedLocations).not.toHaveBeenCalled()
    expect(insertActivities).not.toHaveBeenCalled()
  })

  test('returns 0 when named locations exist but none are opted in', async () => {
    const named = [nl({ id: 'nl-1', auto_create_activity: false })]
    const visits = [visit({ named_location_id: 'nl-1' })]
    const insertActivities = vi.fn()

    const result = await materializeFromVisits('user', visits, {
      getNamedLocations: vi.fn().mockResolvedValue(named),
      insertActivities,
    })

    expect(result).toEqual({ upserted: 0 })
    expect(insertActivities).not.toHaveBeenCalled()
  })
})

describe('materializeForRange', () => {
  test('fetches visits then delegates to materializeFromVisits', async () => {
    const named = [nl({ id: 'nl-1', auto_create_activity: true })]
    const visits = [visit({ named_location_id: 'nl-1' })]
    const start = new Date('2026-04-19T00:00:00Z')
    const end = new Date('2026-04-20T00:00:00Z')

    const getPlaceVisits = vi.fn().mockResolvedValue(visits)
    const getNamedLocations = vi.fn().mockResolvedValue(named)
    const insertActivities = vi.fn().mockResolvedValue(undefined)

    const result = await materializeForRange('user', start, end, {
      getNamedLocations,
      getPlaceVisits,
      insertActivities,
    })

    expect(getPlaceVisits).toHaveBeenCalledWith('user', start, end)
    expect(result).toEqual({ upserted: 1 })
  })
})
