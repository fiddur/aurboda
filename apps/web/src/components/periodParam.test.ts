import { describe, expect, it } from 'vitest'

import { periodParamOf, withPeriodParam } from './periodParam'

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
