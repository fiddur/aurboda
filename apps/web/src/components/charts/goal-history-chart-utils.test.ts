import { describe, expect, test } from 'vitest'

import {
  dayLabel,
  dayTooltip,
  monthLabel,
  monthTooltip,
  statusColor,
  statusLabel,
  yDomainTop,
} from './goal-history-chart-utils'

describe('yDomainTop', () => {
  test('pads the larger of data max and target by 10%', () => {
    expect(yDomainTop(100, 50)).toBeCloseTo(110)
    expect(yDomainTop(10, 50)).toBeCloseTo(55)
    expect(yDomainTop(10, 5, 60)).toBeCloseTo(66)
    expect(yDomainTop(10, undefined, 20)).toBeCloseTo(22)
  })

  test('never collapses to zero', () => {
    expect(yDomainTop(0)).toBe(1)
  })
})

describe('labels', () => {
  test('day and month labels are UTC', () => {
    expect(dayLabel('2026-10-12')).toBe('Oct 12')
    expect(dayLabel('2026-01-01')).toBe('Jan 1')
    expect(monthLabel('2026-10')).toBe("Oct '26")
  })

  test('status label and colour', () => {
    expect(statusLabel('met')).toBe('on target')
    expect(statusLabel('below')).toBe('below target')
    expect(statusLabel('over')).toBe('over target')
    expect(statusColor.below).toBe('#757575')
    expect(statusColor.met).toBe('#4caf50')
    expect(statusColor.over).toBe('#f44336')
  })
})

describe('dayTooltip', () => {
  const format = (v: number) => `${v}u`

  test('with the day contribution', () => {
    expect(
      dayTooltip({ contribution: 42, date: '2026-10-12', partial: false, status: 'met', value: 155 }, format),
    ).toBe('Oct 12: 155u (day: 42u) · on target')
  })

  test('without contribution (trend)', () => {
    expect(dayTooltip({ date: '2026-10-12', partial: false, status: 'below', value: 0.87 }, format)).toBe(
      'Oct 12: 0.87u · below target',
    )
  })

  test('today is marked so far', () => {
    expect(dayTooltip({ date: '2026-10-12', partial: true, status: 'over', value: 3 }, format)).toBe(
      'Oct 12 (today so far): 3u · over target',
    )
  })
})

describe('monthTooltip', () => {
  test('met of total with over', () => {
    expect(
      monthTooltip({
        days_below: 16,
        days_met: 12,
        days_over: 3,
        days_total: 31,
        month: '2026-10',
        partial: false,
      }),
    ).toBe('Oct 2026: 12 of 31 days on target · 3 over')
  })

  test('omits over when 0, marks the partial month', () => {
    expect(
      monthTooltip({
        days_below: 1,
        days_met: 4,
        days_over: 0,
        days_total: 5,
        month: '2026-11',
        partial: true,
      }),
    ).toBe('Nov 2026 (so far): 4 of 5 days on target')
  })
})
