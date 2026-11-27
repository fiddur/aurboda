import { describe, expect, test } from 'vitest'

import type { StepRecord } from '../../db/index.ts'

import { stepsFromRecords } from './activity-steps.ts'

const start = new Date('2026-11-10T10:00:00Z')
const end = new Date('2026-11-10T11:00:00Z')

const record = (from: string, to: string, count: number, modified?: string): StepRecord => ({
  count,
  end: new Date(`2026-11-10T${to}Z`),
  start: new Date(`2026-11-10T${from}Z`),
  ...(modified ? { modified: new Date(`2026-11-10T${modified}Z`) } : {}),
})

describe('stepsFromRecords', () => {
  test('sums records wholly inside the activity', () => {
    expect(
      stepsFromRecords(
        [record('10:10:00', '10:11:00', 120), record('10:11:00', '10:12:00', 130)],
        start,
        end,
      ),
    ).toBe(250)
  })

  test('prorates the first and last records by their overlap', () => {
    const records = [
      record('09:59:00', '10:01:00', 100),
      record('10:30:00', '10:31:00', 150),
      record('10:59:30', '11:00:30', 80),
    ]
    expect(stepsFromRecords(records, start, end)).toBe(50 + 150 + 40)
  })

  test('a record wholly outside contributes nothing', () => {
    const records = [
      record('09:10:00', '09:11:00', 500),
      record('11:00:00', '11:01:00', 500),
      record('10:20:00', '10:21:00', 90),
    ]
    expect(stepsFromRecords(records, start, end)).toBe(90)
  })

  test('records with the same span collapse to the latest written', () => {
    const records = [
      record('10:20:00', '10:21:00', 90, '12:00:00'),
      record('10:20:00', '10:21:00', 110, '13:00:00'),
      record('10:20:00', '10:21:00', 70, '11:00:00'),
    ]
    expect(stepsFromRecords(records, start, end)).toBe(110)
  })

  test('without a modified time the last duplicate wins', () => {
    const records = [record('10:20:00', '10:21:00', 90), record('10:20:00', '10:21:00', 60)]
    expect(stepsFromRecords(records, start, end)).toBe(60)
  })

  test('no records gives undefined', () => {
    expect(stepsFromRecords([], start, end)).toBeUndefined()
  })

  test('a sum that rounds to 0 gives undefined', () => {
    expect(stepsFromRecords([record('10:59:59', '11:01:00', 1)], start, end)).toBeUndefined()
  })

  test('a zero-length record counts whole when it starts inside the activity', () => {
    const records = [record('10:30:00', '10:30:00', 25), record('09:30:00', '09:30:00', 40)]
    expect(stepsFromRecords(records, start, end)).toBe(25)
  })

  test('two partially overlapping records count the overlap once', () => {
    const records = [record('10:00:00', '10:10:00', 100), record('10:05:00', '10:15:00', 100)]
    expect(stepsFromRecords(records, start, end)).toBe(150)
  })

  test('an hourly record beside the minute records inside it adds only its uncovered part', () => {
    const records = [
      record('10:00:00', '11:00:00', 600),
      record('10:10:00', '10:11:00', 120),
      record('10:11:00', '10:12:00', 130),
    ]
    expect(stepsFromRecords(records, start, end)).toBe(120 + 130 + 580)
  })

  test('a zero-length record inside another record adds nothing', () => {
    const records = [record('10:10:00', '10:20:00', 200), record('10:15:00', '10:15:00', 25)]
    expect(stepsFromRecords(records, start, end)).toBe(200)
  })

  test('a coarser record outside the activity still covers what it shares with a finer one', () => {
    const records = [record('09:00:00', '11:00:00', 1200), record('10:30:00', '10:31:00', 50)]
    expect(stepsFromRecords(records, start, end)).toBe(50 + 590)
  })
})
