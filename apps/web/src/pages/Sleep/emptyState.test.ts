import { describe, expect, it } from 'vitest'

import { getSleepScoreEmptyState } from './emptyState'

describe('getSleepScoreEmptyState', () => {
  it('returns null when there are enough scores', () => {
    expect(getSleepScoreEmptyState(2, true)).toBeNull()
    expect(getSleepScoreEmptyState(10, false)).toBeNull()
  })

  it('points to the data-sources page when sleep sessions exist but no scores', () => {
    const state = getSleepScoreEmptyState(0, true)
    expect(state).not.toBeNull()
    expect(state!.message).toMatch(/scoring source/i)
    expect(state!.linkHref).toBe('/data-sources')
    expect(state!.linkLabel).toBeTruthy()
  })

  it('uses the generic message when there is no sleep activity at all', () => {
    const state = getSleepScoreEmptyState(0, false)
    expect(state).not.toBeNull()
    expect(state!.message).toMatch(/not enough sleep data/i)
    expect(state!.linkHref).toBeUndefined()
  })

  it('treats a single score as not enough even with sessions', () => {
    const state = getSleepScoreEmptyState(1, true)
    expect(state).not.toBeNull()
    expect(state!.linkHref).toBe('/data-sources')
  })
})
