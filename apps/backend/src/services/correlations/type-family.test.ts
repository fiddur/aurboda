import { describe, expect, test } from 'vitest'

import { ancestorsByType, typeAndAncestors } from './type-family.ts'

describe('ancestorsByType', () => {
  test('a chain of three levels lists ancestors nearest first', () => {
    const ancestors = ancestorsByType([
      { name: 'running' },
      { name: 'trail_running', parent_type: 'running' },
      { name: 'mountain_trail_running', parent_type: 'trail_running' },
    ])
    expect(ancestors.get('running')).toEqual([])
    expect(ancestors.get('trail_running')).toEqual(['running'])
    expect(ancestors.get('mountain_trail_running')).toEqual(['trail_running', 'running'])
  })

  test('a parent without a definition is still an ancestor', () => {
    const ancestors = ancestorsByType([{ name: 'hot_yoga', parent_type: 'yoga' }])
    expect(ancestors.get('hot_yoga')).toEqual(['yoga'])
    expect(ancestors.has('yoga')).toBe(false)
  })

  test('a cycle stops where a name repeats', () => {
    const ancestors = ancestorsByType([
      { name: 'yoga', parent_type: 'hot_yoga' },
      { name: 'hot_yoga', parent_type: 'yoga' },
      { name: 'meditation', parent_type: 'meditation' },
    ])
    expect(ancestors.get('yoga')).toEqual(['hot_yoga'])
    expect(ancestors.get('hot_yoga')).toEqual(['yoga'])
    expect(ancestors.get('meditation')).toEqual([])
  })
})

describe('typeAndAncestors', () => {
  const ancestors = ancestorsByType([{ name: 'trail_running', parent_type: 'running' }])

  test('a defined type and its ancestors', () => {
    expect(typeAndAncestors('trail_running', ancestors)).toEqual(['trail_running', 'running'])
  })

  test('an undefined type is just itself', () => {
    expect(typeAndAncestors('coffee', ancestors)).toEqual(['coffee'])
  })
})
