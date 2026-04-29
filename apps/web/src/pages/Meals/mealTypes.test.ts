import { describe, expect, test } from 'vitest'

import { DEFAULT_CUSTOM_TYPE, resolveMealTypeChange } from './mealTypes'

describe('resolveMealTypeChange', () => {
  test('picking a known meal type returns it', () => {
    expect(resolveMealTypeChange('lunch', 'breakfast')).toBe('breakfast')
    expect(resolveMealTypeChange('other', 'snack')).toBe('snack')
  })

  test('picking "Other..." while on a known type commits the default custom value', () => {
    expect(resolveMealTypeChange('lunch', '__custom')).toBe(DEFAULT_CUSTOM_TYPE)
    expect(resolveMealTypeChange('breakfast', '__custom')).toBe(DEFAULT_CUSTOM_TYPE)
  })

  test('picking "Other..." while already in custom mode is a no-op', () => {
    // The user already typed "midnight snack" — picking Other... again
    // shouldn't clobber that with "other".
    expect(resolveMealTypeChange('midnight snack', '__custom')).toBeNull()
    expect(resolveMealTypeChange('other', '__custom')).toBeNull()
    expect(resolveMealTypeChange('hot chocolate', '__custom')).toBeNull()
  })
})
