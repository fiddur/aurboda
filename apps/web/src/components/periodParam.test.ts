import { describe, expect, it } from 'vitest'

import { isGranularitySwitch, periodParamOf, withPeriodParam } from './periodParam'

describe('period URL parameter', () => {
  it('sets, replaces and removes the period, keeping the rest of the URL', () => {
    expect(withPeriodParam('https://a.example/u/x/board?embed=1#top', '2026-09')).toBe(
      '/u/x/board?embed=1&period=2026-09#top',
    )
    expect(withPeriodParam('https://a.example/u/x/board?period=2026-09', '2026-08')).toBe(
      '/u/x/board?period=2026-08',
    )
    expect(withPeriodParam('https://a.example/u/x/board?embed=1&period=2026-09', null)).toBe(
      '/u/x/board?embed=1',
    )
  })

  it('reads the period from a query string', () => {
    expect(periodParamOf('?embed=1&period=2026-W44')).toBe('2026-W44')
    expect(periodParamOf('')).toBeNull()
  })
})

describe('isGranularitySwitch', () => {
  it('is a switch between two granularities, or to a rolling board', () => {
    expect(isGranularitySwitch('month', 'week')).toBe(true)
    expect(isGranularitySwitch('month', null)).toBe(true)
  })

  it('is not a switch when the config arrives or nothing changed', () => {
    expect(isGranularitySwitch(null, 'month')).toBe(false)
    expect(isGranularitySwitch('month', 'month')).toBe(false)
    expect(isGranularitySwitch(null, null)).toBe(false)
  })
})
