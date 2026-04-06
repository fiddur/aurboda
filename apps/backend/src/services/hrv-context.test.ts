/**
 * Unit tests for contextual HRV filtering.
 */

import { describe, expect, test } from 'vitest'

import { classifyHrvByContext } from './hrv-context.ts'

describe('classifyHrvByContext', () => {
  test('classifies HRV samples as sleep when in sleep window', () => {
    const hrvData: [Date, number][] = [
      [new Date('2024-01-15T02:00:00Z'), 45],
      [new Date('2024-01-15T03:00:00Z'), 48],
      [new Date('2024-01-15T04:00:00Z'), 50],
    ]

    const sleepWindows = [{ end: new Date('2024-01-15T07:00:00Z'), start: new Date('2024-01-15T00:00:00Z') }]
    const activityWindows: { start: Date; end: Date }[] = []

    const result = classifyHrvByContext(hrvData, sleepWindows, activityWindows)

    expect(result.sleep).toHaveLength(3)
    expect(result.activity).toHaveLength(0)
    expect(result.awake).toHaveLength(0)
    expect(result.sleep.map(([, v]) => v)).toEqual([45, 48, 50])
  })

  test('classifies HRV samples as activity when in exercise window', () => {
    const hrvData: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 25],
      [new Date('2024-01-15T10:15:00Z'), 22],
      [new Date('2024-01-15T10:30:00Z'), 20],
    ]

    const sleepWindows: { start: Date; end: Date }[] = []
    const activityWindows = [
      { end: new Date('2024-01-15T11:00:00Z'), start: new Date('2024-01-15T09:30:00Z') },
    ]

    const result = classifyHrvByContext(hrvData, sleepWindows, activityWindows)

    expect(result.sleep).toHaveLength(0)
    expect(result.activity).toHaveLength(3)
    expect(result.awake).toHaveLength(0)
    expect(result.activity.map(([, v]) => v)).toEqual([25, 22, 20])
  })

  test('classifies HRV samples as awake when not in any window', () => {
    const hrvData: [Date, number][] = [
      [new Date('2024-01-15T12:00:00Z'), 30],
      [new Date('2024-01-15T14:00:00Z'), 28],
      [new Date('2024-01-15T16:00:00Z'), 32],
    ]

    const sleepWindows = [{ end: new Date('2024-01-15T07:00:00Z'), start: new Date('2024-01-15T00:00:00Z') }]
    const activityWindows = [
      { end: new Date('2024-01-15T10:00:00Z'), start: new Date('2024-01-15T09:00:00Z') },
    ]

    const result = classifyHrvByContext(hrvData, sleepWindows, activityWindows)

    expect(result.sleep).toHaveLength(0)
    expect(result.activity).toHaveLength(0)
    expect(result.awake).toHaveLength(3)
    expect(result.awake.map(([, v]) => v)).toEqual([30, 28, 32])
  })

  test('correctly classifies mixed HRV samples across all contexts', () => {
    const hrvData: [Date, number][] = [
      // Sleep samples
      [new Date('2024-01-15T02:00:00Z'), 45],
      [new Date('2024-01-15T04:00:00Z'), 50],
      // Morning awake
      [new Date('2024-01-15T08:00:00Z'), 35],
      // Exercise samples
      [new Date('2024-01-15T10:00:00Z'), 22],
      [new Date('2024-01-15T10:30:00Z'), 18],
      // Afternoon awake
      [new Date('2024-01-15T14:00:00Z'), 30],
      [new Date('2024-01-15T16:00:00Z'), 28],
    ]

    const sleepWindows = [{ end: new Date('2024-01-15T07:00:00Z'), start: new Date('2024-01-15T00:00:00Z') }]
    const activityWindows = [
      { end: new Date('2024-01-15T11:00:00Z'), start: new Date('2024-01-15T09:30:00Z') },
    ]

    const result = classifyHrvByContext(hrvData, sleepWindows, activityWindows)

    expect(result.sleep).toHaveLength(2)
    expect(result.sleep.map(([, v]) => v)).toEqual([45, 50])

    expect(result.activity).toHaveLength(2)
    expect(result.activity.map(([, v]) => v)).toEqual([22, 18])

    expect(result.awake).toHaveLength(3)
    expect(result.awake.map(([, v]) => v)).toEqual([35, 30, 28])
  })

  test('handles samples at window boundaries (inclusive)', () => {
    const hrvData: [Date, number][] = [
      [new Date('2024-01-15T07:00:00Z'), 42], // Exactly at sleep end
      [new Date('2024-01-15T09:30:00Z'), 25], // Exactly at activity start
      [new Date('2024-01-15T11:00:00Z'), 22], // Exactly at activity end
    ]

    const sleepWindows = [{ end: new Date('2024-01-15T07:00:00Z'), start: new Date('2024-01-15T00:00:00Z') }]
    const activityWindows = [
      { end: new Date('2024-01-15T11:00:00Z'), start: new Date('2024-01-15T09:30:00Z') },
    ]

    const result = classifyHrvByContext(hrvData, sleepWindows, activityWindows)

    expect(result.sleep).toHaveLength(1) // 07:00 is within sleep (<=end)
    expect(result.activity).toHaveLength(2) // 09:30 and 11:00 are within activity
    expect(result.awake).toHaveLength(0)
  })

  test('handles empty HRV data', () => {
    const hrvData: [Date, number][] = []
    const sleepWindows = [{ end: new Date('2024-01-15T07:00:00Z'), start: new Date('2024-01-15T00:00:00Z') }]
    const activityWindows: { start: Date; end: Date }[] = []

    const result = classifyHrvByContext(hrvData, sleepWindows, activityWindows)

    expect(result.sleep).toHaveLength(0)
    expect(result.activity).toHaveLength(0)
    expect(result.awake).toHaveLength(0)
  })

  test('handles empty windows (all samples become awake)', () => {
    const hrvData: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 30],
      [new Date('2024-01-15T12:00:00Z'), 28],
    ]

    const sleepWindows: { start: Date; end: Date }[] = []
    const activityWindows: { start: Date; end: Date }[] = []

    const result = classifyHrvByContext(hrvData, sleepWindows, activityWindows)

    expect(result.sleep).toHaveLength(0)
    expect(result.activity).toHaveLength(0)
    expect(result.awake).toHaveLength(2)
  })

  test('handles multiple sleep windows (e.g., naps)', () => {
    const hrvData: [Date, number][] = [
      [new Date('2024-01-15T02:00:00Z'), 45], // Night sleep
      [new Date('2024-01-15T10:00:00Z'), 30], // Awake
      [new Date('2024-01-15T14:30:00Z'), 40], // Nap
    ]

    const sleepWindows = [
      { end: new Date('2024-01-15T07:00:00Z'), start: new Date('2024-01-15T00:00:00Z') }, // Night
      { end: new Date('2024-01-15T15:00:00Z'), start: new Date('2024-01-15T14:00:00Z') }, // Nap
    ]
    const activityWindows: { start: Date; end: Date }[] = []

    const result = classifyHrvByContext(hrvData, sleepWindows, activityWindows)

    expect(result.sleep).toHaveLength(2)
    expect(result.sleep.map(([, v]) => v)).toEqual([45, 40])
    expect(result.awake).toHaveLength(1)
    expect(result.awake.map(([, v]) => v)).toEqual([30])
  })

  test('sleep window takes priority over activity (overlapping windows)', () => {
    // This scenario shouldn't happen in practice, but tests the implementation
    const hrvData: [Date, number][] = [[new Date('2024-01-15T06:30:00Z'), 42]]

    const sleepWindows = [{ end: new Date('2024-01-15T07:00:00Z'), start: new Date('2024-01-15T00:00:00Z') }]
    const activityWindows = [
      { end: new Date('2024-01-15T08:00:00Z'), start: new Date('2024-01-15T06:00:00Z') },
    ]

    const result = classifyHrvByContext(hrvData, sleepWindows, activityWindows)

    // Sleep check comes first, so it's classified as sleep
    expect(result.sleep).toHaveLength(1)
    expect(result.activity).toHaveLength(0)
  })
})
