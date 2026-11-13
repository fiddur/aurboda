import { describe, expect, test } from 'vitest'

import {
  type HomeAssistantState,
  historySlices,
  stateToLocation,
  trackableEntities,
  zoneRegions,
} from './process.ts'

const trackerState = (overrides: Partial<HomeAssistantState> = {}): HomeAssistantState => ({
  attributes: {
    altitude: 31,
    course: 90,
    friendly_name: 'Pixel 8',
    gps_accuracy: 12,
    latitude: 59.33,
    longitude: 18.06,
    source_type: 'gps',
    speed: 2.5,
    vertical_accuracy: 3,
  },
  entity_id: 'device_tracker.pixel_8',
  last_changed: '2026-11-10T08:00:00+00:00',
  last_updated: '2026-11-10T08:05:00.123+00:00',
  state: 'not_home',
  ...overrides,
})

describe('zoneRegions', () => {
  test.each([
    ['home', ['Home']],
    ['not_home', []],
    ['unknown', []],
    ['unavailable', []],
    ['', []],
    ['Work', ['Work']],
    ['Gym, "North"', ['Gym, "North"']],
  ])('%s → %j', (state, expected) => {
    expect(zoneRegions(state)).toEqual(expected)
  })
})

describe('stateToLocation', () => {
  test('maps a companion-app device_tracker state', () => {
    const location = stateToLocation(trackerState({ state: 'Work' }))
    expect(location).toEqual({
      accuracy: 12,
      altitude: 31,
      lat: 59.33,
      lon: 18.06,
      regions: ['Work'],
      source: 'home_assistant',
      time: new Date('2026-11-10T08:05:00.123Z'),
      velocity: 9,
    })
  })

  test('maps a person state without altitude or speed', () => {
    const location = stateToLocation({
      attributes: { gps_accuracy: 20, latitude: 59.3, longitude: 18.1 },
      entity_id: 'person.fredrik',
      last_updated: '2026-11-10T09:00:00+00:00',
      state: 'home',
    })
    expect(location).toEqual({
      accuracy: 20,
      altitude: undefined,
      lat: 59.3,
      lon: 18.1,
      regions: ['Home'],
      source: 'home_assistant',
      time: new Date('2026-11-10T09:00:00Z'),
      velocity: undefined,
    })
  })

  test('drops a negative speed (iOS reports -1 for none)', () => {
    expect(
      stateToLocation(trackerState({ attributes: { latitude: 1, longitude: 2, speed: -1 } }))?.velocity,
    ).toBeUndefined()
  })

  test('converts speed from m/s to km/h', () => {
    expect(
      stateToLocation(trackerState({ attributes: { latitude: 1, longitude: 2, speed: 10 } }))?.velocity,
    ).toBe(36)
  })

  test.each([
    ['missing coordinates', {}],
    ['string coordinates', { latitude: '59.3', longitude: '18.1' }],
    ['latitude out of range', { latitude: 91, longitude: 18 }],
    ['longitude out of range', { latitude: 59, longitude: -181 }],
    ['non-finite coordinates', { latitude: Number.NaN, longitude: 18 }],
  ])('skips a state with %s', (_label, attributes) => {
    expect(stateToLocation(trackerState({ attributes }))).toBeNull()
  })

  test('skips a state with an unparseable last_updated', () => {
    expect(stateToLocation(trackerState({ last_updated: 'yesterday' }))).toBeNull()
  })
})

describe('trackableEntities', () => {
  test('keeps person and device_tracker entities with coordinates, person first', () => {
    const states: HomeAssistantState[] = [
      trackerState({ entity_id: 'device_tracker.b_phone' }),
      trackerState({ attributes: { latitude: 1, longitude: 2 }, entity_id: 'device_tracker.a_phone' }),
      trackerState({
        attributes: { friendly_name: 'Fredrik', latitude: 1, longitude: 2 },
        entity_id: 'person.fredrik',
        state: 'home',
      }),
      trackerState({ attributes: { friendly_name: 'Router' }, entity_id: 'device_tracker.router' }),
      trackerState({ entity_id: 'sensor.phone_battery' }),
    ]
    expect(trackableEntities(states)).toEqual([
      { entity_id: 'person.fredrik', name: 'Fredrik', state: 'home' },
      { entity_id: 'device_tracker.a_phone', name: null, state: 'not_home' },
      { entity_id: 'device_tracker.b_phone', name: 'Pixel 8', state: 'not_home' },
    ])
  })
})

describe('historySlices', () => {
  const start = new Date('2026-11-01T00:00:00Z')
  const hours = (n: number) => new Date(start.getTime() + n * 3_600_000)

  test('is empty for an empty or inverted window', () => {
    expect(historySlices(start, start)).toEqual([])
    expect(historySlices(hours(1), start)).toEqual([])
  })

  test('is one slice for less than 24 h', () => {
    expect(historySlices(start, hours(5))).toEqual([{ end: hours(5), start }])
  })

  test('is one slice for exactly 24 h', () => {
    expect(historySlices(start, hours(24))).toEqual([{ end: hours(24), start }])
  })

  test('covers 10 days in 10 consecutive daily slices', () => {
    const slices = historySlices(start, hours(240))
    expect(slices).toHaveLength(10)
    expect(slices[0]).toEqual({ end: hours(24), start })
    expect(slices[9]).toEqual({ end: hours(240), start: hours(216) })
    slices.slice(1).forEach((slice, i) => expect(slice.start).toEqual(slices[i].end))
  })
})
