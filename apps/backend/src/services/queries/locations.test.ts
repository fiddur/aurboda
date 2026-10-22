import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as visitActivities from '../location-visit-activities.ts'
import * as locations from '../locations.ts'
import { queryLocations } from './locations.ts'

vi.mock('../../db/index.ts', () => ({ getNamedLocations: vi.fn(), insertActivities: vi.fn() }))
vi.mock('../locations.ts', () => ({ getPlaceVisits: vi.fn() }))
vi.mock('../location-visit-activities.ts', () => ({ materializeFromVisits: vi.fn() }))

const start = new Date('2026-10-07T10:05:00Z')
const end = new Date('2026-10-07T10:25:00Z')

describe('queryLocations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(visitActivities.materializeFromVisits).mockResolvedValue({ upserted: 0 })
    vi.mocked(locations.getPlaceVisits).mockResolvedValue([
      {
        duration_minutes: 15,
        end_time: new Date('2026-10-07T10:20:00Z'),
        lat: 57.57,
        lon: 12.61,
        name: 'Home',
        named_location_id: 'home',
        source: 'named',
        start_time: start,
      },
    ])
  })

  test('materializes location_visit activities from observed visits', async () => {
    const places = await queryLocations('u', start, end)

    expect(places.map((p) => p.name)).toEqual(['Home'])
    expect(visitActivities.materializeFromVisits).toHaveBeenCalledTimes(1)
  })

  test('never materializes when the last known place is asked for, extended visits included', async () => {
    const places = await queryLocations('u', start, end, { lastKnownHours: 6 })

    expect(locations.getPlaceVisits).toHaveBeenCalledWith('u', start, end, { lastKnownHours: 6 })
    expect(places.map((p) => [p.name, p.start_time])).toEqual([['Home', start.toISOString()]])
    expect(visitActivities.materializeFromVisits).not.toHaveBeenCalled()
  })
})
