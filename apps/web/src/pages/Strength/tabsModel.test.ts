import { describe, expect, test } from 'vitest'

import { STRENGTH_TABS, strengthTabForPath } from './tabsModel'

describe('strengthTabForPath', () => {
  test('finds each tab by its address', () => {
    expect(strengthTabForPath('/strength')).toBe('train')
    expect(strengthTabForPath('/strength/progress')).toBe('progress')
    expect(strengthTabForPath('/strength/exercises')).toBe('exercises')
    expect(strengthTabForPath('/strength/muscles')).toBe('muscles')
  })

  test('ignores the query string, hash and a trailing slash', () => {
    expect(strengthTabForPath('/strength?embed=1')).toBe('train')
    expect(strengthTabForPath('/strength/progress/')).toBe('progress')
    expect(strengthTabForPath('/strength/muscles#recovery')).toBe('muscles')
  })

  test('is undefined for the other strength pages', () => {
    expect(strengthTabForPath('/strength/live')).toBeUndefined()
    expect(strengthTabForPath('/strength/log')).toBeUndefined()
    expect(strengthTabForPath('/strength/session/x')).toBeUndefined()
    expect(strengthTabForPath('/strength/plan/new')).toBeUndefined()
    expect(strengthTabForPath('/strengthening')).toBeUndefined()
  })

  test('lists the four tabs in order', () => {
    expect(STRENGTH_TABS.map((t) => t.label)).toEqual(['Train', 'Progress', 'Exercises', 'Muscles'])
  })
})
