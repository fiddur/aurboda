import { describe, expect, it } from 'vitest'

import {
  defaultTimes,
  fieldsFromSet,
  hasMeasure,
  parseNumber,
  sessionInterval,
  setFromFields,
  stepValue,
  timesFromActivity,
} from './formModel'

describe('parseNumber', () => {
  it('reads a decimal comma and rejects junk', () => {
    expect(parseNumber('62,5')).toBe(62.5)
    expect(parseNumber(' 8 ')).toBe(8)
    expect(parseNumber('')).toBeUndefined()
    expect(parseNumber('abc')).toBeUndefined()
  })
})

describe('stepValue', () => {
  it('steps on the grid of the step and never below zero', () => {
    expect(stepValue('60', 2.5)).toBe('62.5')
    expect(stepValue('62.5', -2.5)).toBe('60')
    expect(stepValue('', 2.5)).toBe('2.5')
    expect(stepValue('1', -2.5)).toBe('0')
    expect(stepValue('20.5', 0.5)).toBe('21')
    expect(stepValue('8', 1)).toBe('9')
  })
})

describe('set fields', () => {
  it('round-trips a set and clears blank fields as undefined', () => {
    const fields = fieldsFromSet({ note: 'easy', reps: 8, rpe: 7, set_type: 'warmup', weight: 60 })
    expect(fields).toEqual({
      distance: '',
      note: 'easy',
      reps: '8',
      rir: '',
      rpe: '7',
      set_type: 'warmup',
      time: '',
      weight: '60',
    })
    expect(setFromFields({ ...fields, note: ' ', rpe: '' })).toEqual({
      distance: undefined,
      note: undefined,
      reps: 8,
      rir: undefined,
      rpe: undefined,
      set_type: 'warmup',
      time: undefined,
      weight: 60,
    })
  })

  it('needs a weight, reps, time or distance', () => {
    expect(hasMeasure(fieldsFromSet({}))).toBe(false)
    expect(hasMeasure(fieldsFromSet({ time: 30 }))).toBe(true)
  })
})

describe('session times', () => {
  it('defaults to one hour ago for 60 minutes', () => {
    expect(defaultTimes(new Date(2026, 10, 14, 18, 30))).toEqual({
      date: '2026-11-14',
      minutes: '60',
      time: '17:30',
    })
  })

  it('turns date, time and minutes into an interval and back', () => {
    const interval = sessionInterval({ date: '2026-11-10', minutes: '58', time: '17:02' })
    expect(interval).toEqual({
      end_time: new Date(2026, 10, 10, 18, 0).toISOString(),
      start_time: new Date(2026, 10, 10, 17, 2).toISOString(),
    })
    expect(timesFromActivity(new Date(2026, 10, 10, 17, 2), new Date(2026, 10, 10, 18, 0))).toEqual({
      date: '2026-11-10',
      minutes: '58',
      time: '17:02',
    })
    expect(sessionInterval({ date: '', minutes: '60', time: '17:00' })).toBeUndefined()
    expect(sessionInterval({ date: '2026-11-10', minutes: '', time: '17:00' })).toBeUndefined()
  })
})
