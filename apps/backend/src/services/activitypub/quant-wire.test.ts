import { describe, expect, test } from 'vitest'

import {
  fromWireKey,
  normalizeStructuredActivity,
  normalizeWellKnownQuantpub,
  toWireKey,
  wireMetricToMetricType,
} from './quant-wire.ts'

describe('toWireKey / fromWireKey', () => {
  test.each([
    ['heart_rate_avg', 'heartRateAvg'],
    ['hr_zone_minutes', 'hrZoneMinutes'],
    ['heart_rate', 'heartRate'],
    ['steps', 'steps'],
    ['vo2_max', 'vo2Max'],
  ])('%s <-> %s', (snake, camel) => {
    expect(toWireKey(snake)).toBe(camel)
    expect(fromWireKey(camel)).toBe(snake)
  })

  test('idempotent on already-converted input', () => {
    expect(toWireKey('heartRate')).toBe('heartRate')
    expect(fromWireKey('heart_rate')).toBe('heart_rate')
    expect(toWireKey(toWireKey('heart_rate_max'))).toBe('heartRateMax')
  })
})

describe('wireMetricToMetricType', () => {
  test('accepts the camelCase and the snake_case form', () => {
    expect(wireMetricToMetricType('heartRate')).toBe('heart_rate')
    expect(wireMetricToMetricType('heart_rate')).toBe('heart_rate')
    expect(wireMetricToMetricType('stressLevel')).toBe('stress_level')
    expect(wireMetricToMetricType('spo2')).toBe('spo2')
  })

  test('maps keys whose segments start with a digit', () => {
    expect(toWireKey('hr_zone_2_sec')).toBe('hrZone2Sec')
    expect(wireMetricToMetricType('hrZone2Sec')).toBe('hr_zone_2_sec')
  })

  test('unknown key is null', () => {
    expect(wireMetricToMetricType('nope')).toBeNull()
    expect(wireMetricToMetricType('heartRateAvg')).toBeNull()
    expect(wireMetricToMetricType('')).toBeNull()
  })
})

const legacy = {
  activity_type: 'running',
  duration_seconds: 2463,
  end_time: '2026-07-01T07:11:03.000Z',
  kind: 'activity',
  message: 'Nice run',
  metrics: [
    { key: 'heart_rate_avg', unit: 'bpm', value: 142 },
    { key: 'hr_zone_minutes', value: { z2: 22, z3: 9 } },
  ],
  series: [{ bucket: '5s', metric: 'heart_rate', samples: [], unit: 'bpm' }],
  start_time: '2026-07-01T06:30:00.000Z',
  title: 'Morning run',
}

const current = {
  activityType: 'running',
  endTime: '2026-07-01T07:11:03.000Z',
  kind: 'activity',
  message: 'Nice run',
  metrics: [
    { key: 'heartRateAvg', unit: 'bpm', value: 142 },
    { key: 'hrZoneMinutes', value: { z2: 22, z3: 9 } },
  ],
  name: 'Morning run',
  series: [{ bucket: '5s', metric: 'heartRate', samples: [], unit: 'bpm' }],
  startTime: '2026-07-01T06:30:00.000Z',
}

describe('normalizeStructuredActivity', () => {
  test('converts a 0.1 payload to 0.2', () => {
    expect(normalizeStructuredActivity(legacy)).toEqual(current)
  })

  test('returns a 0.2 payload unchanged', () => {
    expect(normalizeStructuredActivity(current)).toBe(current)
  })

  test('treats a payload without kind as an activity', () => {
    const { kind: _kind, ...noKind } = legacy
    const { kind: _k, ...expected } = current
    expect(normalizeStructuredActivity(noKind)).toEqual(expected)
  })

  test('never touches an article', () => {
    const article = { blocks: [], kind: 'article', title: 'Notes' }
    expect(normalizeStructuredActivity(article)).toBe(article)
  })

  test('converts snake metric keys on an otherwise 0.2 payload', () => {
    const mixed = { ...current, metrics: [{ key: 'heart_rate_max', value: 170 }] }
    expect(normalizeStructuredActivity(mixed)).toEqual({
      ...current,
      metrics: [{ key: 'heartRateMax', value: 170 }],
    })
  })

  test('passes non-objects through', () => {
    expect(normalizeStructuredActivity(null)).toBeNull()
    expect(normalizeStructuredActivity('x')).toBe('x')
    expect(normalizeStructuredActivity([1])).toEqual([1])
  })
})

describe('normalizeWellKnownQuantpub', () => {
  test('renames api_base to apiBase', () => {
    expect(
      normalizeWellKnownQuantpub({ api_base: 'https://x/api', product: 'p', quantpub: '0.1', version: '1' }),
    ).toEqual({ apiBase: 'https://x/api', product: 'p', quantpub: '0.1', version: '1' })
  })

  test('leaves a 0.2 document unchanged', () => {
    const doc = { apiBase: 'https://x/api', product: 'p', quantpub: '0.2', version: '1' }
    expect(normalizeWellKnownQuantpub(doc)).toBe(doc)
  })

  test('passes non-objects through', () => {
    expect(normalizeWellKnownQuantpub(undefined)).toBeUndefined()
  })
})
