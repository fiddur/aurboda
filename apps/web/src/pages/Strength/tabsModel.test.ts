import { describe, expect, test } from 'vitest'

import { musclesRedirectTarget, STRENGTH_TABS, strengthTabForPath } from './tabsModel'

describe('strengthTabForPath', () => {
  test('finds each tab by its address', () => {
    expect(strengthTabForPath('/strength')).toBe('muscles')
    expect(strengthTabForPath('/strength/workouts')).toBe('workouts')
    expect(strengthTabForPath('/strength/progress')).toBe('progress')
    expect(strengthTabForPath('/strength/exercises')).toBe('exercises')
  })

  test('ignores the query string, hash and a trailing slash', () => {
    expect(strengthTabForPath('/strength?embed=1')).toBe('muscles')
    expect(strengthTabForPath('/strength/progress/')).toBe('progress')
    expect(strengthTabForPath('/strength/workouts#planned')).toBe('workouts')
  })

  test('is undefined for the other strength pages', () => {
    expect(strengthTabForPath('/strength/live')).toBeUndefined()
    expect(strengthTabForPath('/strength/log')).toBeUndefined()
    expect(strengthTabForPath('/strength/session/x')).toBeUndefined()
    expect(strengthTabForPath('/strength/plan/new')).toBeUndefined()
    expect(strengthTabForPath('/strength/muscles')).toBeUndefined()
    expect(strengthTabForPath('/strengthening')).toBeUndefined()
  })

  test('lists the four tabs in order', () => {
    expect(STRENGTH_TABS.map((t) => t.label)).toEqual(['Muscles', 'Workouts', 'Progress', 'Exercises'])
  })
})

describe('musclesRedirectTarget', () => {
  test('leads to the Muscles tab, keeping the query string', () => {
    expect(musclesRedirectTarget('/strength/muscles')).toBe('/strength')
    expect(musclesRedirectTarget('/strength/muscles?embed=1')).toBe('/strength?embed=1')
  })
})
