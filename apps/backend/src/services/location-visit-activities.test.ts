import { describe, expect, test } from 'vitest'

import type { NamedLocation } from '../db/types.ts'
import type { PlaceVisit } from './locations.ts'

import { visitsToActivities } from './location-visit-activities.ts'

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
