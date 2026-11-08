import { describe, expect, test } from 'vitest'

import {
  formatDistanceKm,
  formatHoursMinutes,
  formatPace,
  formatSpeed,
  speedDisplayFor,
} from './activityTypeCard'

describe('speedDisplayFor', () => {
  test('defaults to pace for running, walking and hiking types', () => {
    expect(speedDisplayFor({ pattern: 'running' })).toBe('pace')
    expect(speedDisplayFor({ pattern: 'trail_run' })).toBe('pace')
    expect(speedDisplayFor({ pattern: 'walking' })).toBe('pace')
    expect(speedDisplayFor({ pattern: 'hiking' })).toBe('pace')
  })

  test('defaults to speed for other types', () => {
    expect(speedDisplayFor({ pattern: 'cycling' })).toBe('speed')
    expect(speedDisplayFor({ pattern: 'exercise' })).toBe('speed')
  })

  test('follows the configured choice', () => {
    expect(speedDisplayFor({ pattern: 'running', speed_display: 'speed' })).toBe('speed')
    expect(speedDisplayFor({ pattern: 'cycling', speed_display: 'pace' })).toBe('pace')
  })
})

describe('formatting', () => {
  test('formats pace as minutes and seconds per km', () => {
    expect(formatPace(330)).toBe('5:30 /km')
    expect(formatPace(299.6)).toBe('5:00 /km')
    expect(formatPace(365)).toBe('6:05 /km')
  })

  test('formats speed and distance to one decimal', () => {
    expect(formatSpeed(24.26)).toBe('24.3 km/h')
    expect(formatDistanceKm(42.195)).toBe('42.2 km')
  })

  test('formats minutes as hours and minutes', () => {
    expect(formatHoursMinutes(431.4)).toBe('7h 11m')
    expect(formatHoursMinutes(45)).toBe('45m')
    expect(formatHoursMinutes(120)).toBe('2h')
  })
})
