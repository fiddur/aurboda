import { describe, expect, test } from 'vitest'

import { mapLegacyCategorySource } from './legacySource'

const categories = [
  { activity_type_name: 'work', name: ['Work'] },
  { activity_type_name: 'software_dev', name: ['Work', 'Software Dev'] },
  { name: ['Untyped'] },
]

describe('mapLegacyCategorySource', () => {
  test('maps a category path to its activity type, summing hours by default', () => {
    expect(mapLegacyCategorySource({ pattern: 'Work > Software Dev' }, categories)).toEqual({
      aggregation: 'sum',
      pattern: 'software_dev',
      source_type: 'activity_type',
    })
  })

  test('keeps an aggregation the URL asked for', () => {
    expect(mapLegacyCategorySource({ aggregation: 'count', pattern: 'Work' }, categories)).toEqual({
      aggregation: 'count',
      pattern: 'work',
      source_type: 'activity_type',
    })
  })

  test('falls back to an empty pattern for an unknown path', () => {
    expect(mapLegacyCategorySource({ pattern: 'Gone' }, categories).pattern).toBe('')
  })

  test('falls back to an empty pattern for a category without a type', () => {
    expect(mapLegacyCategorySource({ pattern: 'Untyped' }, categories).pattern).toBe('')
  })

  test('does not match a path prefix', () => {
    expect(mapLegacyCategorySource({ pattern: 'Work > Soft' }, categories).pattern).toBe('')
  })
})
