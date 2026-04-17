import { describe, expect, test } from 'vitest'

import { mapStravaSportType, stravaSportTypeMap } from './sport-type-map.ts'

describe('mapStravaSportType', () => {
  test('maps common running types', () => {
    expect(mapStravaSportType('Run')).toBe('running')
    expect(mapStravaSportType('TrailRun')).toBe('running')
    expect(mapStravaSportType('VirtualRun')).toBe('running_treadmill')
  })

  test('maps cycling types', () => {
    expect(mapStravaSportType('Ride')).toBe('biking')
    expect(mapStravaSportType('MountainBikeRide')).toBe('biking')
    expect(mapStravaSportType('VirtualRide')).toBe('biking_stationary')
  })

  test('maps swimming', () => {
    expect(mapStravaSportType('Swim')).toBe('swimming_pool')
  })

  test('maps walking and hiking', () => {
    expect(mapStravaSportType('Walk')).toBe('walking')
    expect(mapStravaSportType('Hike')).toBe('hiking')
  })

  test('maps gym activities', () => {
    expect(mapStravaSportType('WeightTraining')).toBe('weight_training')
    expect(mapStravaSportType('Yoga')).toBe('yoga')
    expect(mapStravaSportType('Elliptical')).toBe('elliptical')
  })

  test('maps winter sports', () => {
    expect(mapStravaSportType('AlpineSki')).toBe('skiing_downhill')
    expect(mapStravaSportType('NordicSki')).toBe('skiing_cross_country')
    expect(mapStravaSportType('Snowboard')).toBe('snowboarding')
  })

  test('falls back to snake_case for unknown types', () => {
    expect(mapStravaSportType('MuayThai')).toBe('muay_thai')
    expect(mapStravaSportType('Parkour')).toBe('parkour')
    expect(mapStravaSportType('SomeNewSportType')).toBe('some_new_sport_type')
  })

  test('all mapped values are valid snake_case', () => {
    const snakeCasePattern = /^[a-z][a-z0-9_]*$/
    for (const [sportType, activityType] of Object.entries(stravaSportTypeMap)) {
      expect(activityType, `${sportType} → ${activityType}`).toMatch(snakeCasePattern)
    }
  })
})
