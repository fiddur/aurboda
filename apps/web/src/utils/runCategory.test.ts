import { describe, expect, test } from 'vitest'

import { normalizeCategoryName } from './runCategory'

describe('normalizeCategoryName', () => {
  test('snake_cases free text and rejects what cannot be a name', () => {
    expect(normalizeCategoryName('  Hill Repeats ')).toBe('hill_repeats')
    expect(normalizeCategoryName('low_hr')).toBe('low_hr')
    expect(normalizeCategoryName('9k')).toBeNull()
    expect(normalizeCategoryName('!!')).toBeNull()
  })
})
