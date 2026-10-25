import { describe, expect, test } from 'vitest'

import { goalHistoryRanges, goalsUrl, parseRange, rangeToQuery, summaryText } from './goal-history-range'

describe('rangeToQuery', () => {
  test('maps each range', () => {
    expect(goalHistoryRanges).toEqual(['30d', '90d', '1y'])
    expect(rangeToQuery('30d')).toEqual({ bucket: 'day', lookback_days: 30 })
    expect(rangeToQuery('90d')).toEqual({ bucket: 'day', lookback_days: 90 })
    expect(rangeToQuery('1y')).toEqual({ bucket: 'month', lookback_days: 365 })
  })
})

describe('parseRange', () => {
  test('known ranges pass through, anything else is 30d', () => {
    expect(parseRange('90d')).toBe('90d')
    expect(parseRange('1y')).toBe('1y')
    expect(parseRange(undefined)).toBe('30d')
    expect(parseRange('2y')).toBe('30d')
  })
})

describe('summaryText', () => {
  const summary = { days_below: 15, days_met: 12, days_over: 3, days_total: 30 }

  test('met of total with over count', () => {
    expect(summaryText(summary, 'month')).toBe('On target 12 of 30 days · 3 over')
  })

  test('omits over when 0', () => {
    expect(summaryText({ ...summary, days_over: 0 }, 'day')).toBe('On target 12 of 30 days')
  })

  test('singular day', () => {
    expect(summaryText({ days_below: 0, days_met: 1, days_over: 0, days_total: 1 }, 'day')).toBe(
      'On target 1 of 1 day',
    )
  })

  test("appends today's status for the day bucket only", () => {
    expect(summaryText(summary, 'day', 'met')).toBe(
      'On target 12 of 30 days · 3 over · today so far: on target',
    )
    expect(summaryText({ ...summary, days_over: 0 }, 'day', 'below')).toBe(
      'On target 12 of 30 days · today so far: below target',
    )
    expect(summaryText({ ...summary, days_over: 0 }, 'day', 'over')).toBe(
      'On target 12 of 30 days · today so far: over target',
    )
    expect(summaryText({ ...summary, days_over: 0 }, 'month', 'over')).toBe('On target 12 of 30 days')
  })
})

describe('goalsUrl', () => {
  test('opens a goal with its range', () => {
    expect(goalsUrl({ history: 'g1', range: '90d' })).toBe('/goals?history=g1&range=90d')
  })

  test('closing keeps the range', () => {
    expect(goalsUrl({ range: '1y' })).toBe('/goals?range=1y')
  })

  test('preserves embed', () => {
    expect(goalsUrl({ embed: true, history: 'g1', range: '30d' })).toBe('/goals?history=g1&range=30d&embed=1')
  })
})
