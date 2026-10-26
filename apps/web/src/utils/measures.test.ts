import { describe, expect, test } from 'vitest'

import { formatMeasure, formatSet, formatSets, measureSet, topSet } from './measures'

const THIN = ' '

describe('formatMeasure', () => {
  test('volume groups thousands with a thin space and drops decimals', () => {
    expect(formatMeasure('volume', 4320)).toBe(`4${THIN}320 kg`)
    expect(formatMeasure('volume', 1_234_567.6)).toBe(`1${THIN}234${THIN}568 kg`)
    expect(formatMeasure('volume', 640)).toBe('640 kg')
  })

  test('weights keep one decimal and drop a trailing .0', () => {
    expect(formatMeasure('e1rm', 102.5)).toBe('102.5 kg')
    expect(formatMeasure('max_weight', 100)).toBe('100 kg')
    expect(formatMeasure('e1rm', 106.66)).toBe('106.7 kg')
  })

  test('set count is a bare number', () => {
    expect(formatMeasure('set_count', 24)).toBe('24')
  })

  test('max time is m:ss', () => {
    expect(formatMeasure('max_time', 90)).toBe('1:30')
    expect(formatMeasure('max_time', 5)).toBe('0:05')
    expect(formatMeasure('max_time', 3725)).toBe('62:05')
  })
})

describe('formatSet', () => {
  test('reps and weight', () => {
    expect(formatSet({ reps: 8, weight: 80 })).toBe('8×80 kg')
  })

  test('reps only, weight only, time, distance', () => {
    expect(formatSet({ reps: 15, weight: null })).toBe('15 reps')
    expect(formatSet({ reps: null, weight: 80 })).toBe('80 kg')
    expect(formatSet({ time: 90 })).toBe('1:30')
    expect(formatSet({ distance: 40 })).toBe('40 m')
    expect(formatSet({ reps: 10, time: 30 })).toBe('10 reps 0:30')
  })

  test('a dash when nothing is set', () => {
    expect(formatSet({ exercise: 'Plank' })).toBe('—')
  })

  test('set type flags', () => {
    expect(formatSet({ reps: 8, set_type: 'warmup', weight: 60 })).toBe('8×60 kg (w)')
    expect(formatSet({ reps: 8, set_type: 'drop_set', weight: 60 })).toBe('8×60 kg (drop)')
    expect(formatSet({ reps: 8, set_type: 'failure', weight: 60 })).toBe('8×60 kg (f)')
    expect(formatSet({ reps: 8, set_type: 'normal', weight: 60 })).toBe('8×60 kg')
  })
})

describe('formatSets', () => {
  test('joins with a comma', () => {
    expect(
      formatSets([
        { reps: 8, set_type: 'warmup', weight: 60 },
        { reps: 8, weight: 80 },
      ]),
    ).toBe('8×60 kg (w), 8×80 kg')
    expect(formatSets([])).toBe('')
  })
})

describe('topSet', () => {
  test('the heaviest working set, more reps breaking a tie', () => {
    const sets = [
      { reps: 5, set_type: 'warmup', weight: 120 },
      { reps: 8, weight: 80 },
      { reps: 6, weight: 85 },
      { reps: 8, weight: 85 },
    ]
    expect(topSet(sets)).toBe(sets[3])
  })

  test('the most reps without weights', () => {
    const sets = [{ reps: 12 }, { reps: 15 }, { reps: 10 }]
    expect(topSet(sets)).toBe(sets[1])
  })

  test('the longest time without weights or reps', () => {
    const sets = [{ time: 30 }, { time: 60 }, { time: 45 }]
    expect(topSet(sets)).toBe(sets[1])
  })

  test('undefined with no working set', () => {
    expect(topSet([])).toBeUndefined()
    expect(topSet([{ reps: 8, set_type: 'warmup', weight: 60 }])).toBeUndefined()
    expect(topSet([{ exercise: 'x' }])).toBeUndefined()
  })
})

describe('measureSet', () => {
  const sets = [
    { reps: 1, weight: 100 },
    { reps: 10, weight: 90 },
    { reps: 12, set_type: 'warmup', weight: 95 },
    { time: 40 },
  ]

  test('e1rm picks the set with the highest Epley estimate', () => {
    expect(measureSet(sets, 'e1rm')).toBe(sets[1])
  })

  test('max_weight picks the top set', () => {
    expect(measureSet(sets, 'max_weight')).toBe(sets[0])
  })

  test('max_time picks the longest working set', () => {
    expect(measureSet(sets, 'max_time')).toBe(sets[3])
  })

  test('undefined for measures that are not one set', () => {
    expect(measureSet(sets, 'volume')).toBeUndefined()
    expect(measureSet(sets, 'set_count')).toBeUndefined()
  })
})
