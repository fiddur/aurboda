import { describe, expect, test } from 'vitest'

import { isPublicToVisibility, visibilityToIsPublic } from './visibility.ts'

describe('isPublicToVisibility', () => {
  test('true → public, false → unlisted', () => {
    expect(isPublicToVisibility(true)).toBe('public')
    expect(isPublicToVisibility(false)).toBe('unlisted')
  })
})

describe('visibilityToIsPublic', () => {
  test('public → true, unlisted → false', () => {
    expect(visibilityToIsPublic('public')).toBe(true)
    expect(visibilityToIsPublic('unlisted')).toBe(false)
  })

  test('round-trips both directions', () => {
    for (const isPublic of [true, false]) {
      expect(visibilityToIsPublic(isPublicToVisibility(isPublic))).toBe(isPublic)
    }
    for (const visibility of ['public', 'unlisted'] as const) {
      expect(isPublicToVisibility(visibilityToIsPublic(visibility))).toBe(visibility)
    }
  })
})
