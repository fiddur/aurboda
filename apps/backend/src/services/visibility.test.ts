import { describe, expect, test } from 'vitest'

import {
  dashboardVisibilityOf,
  dashboardVisibilityToFlags,
  isPublicToVisibility,
  visibilityToIsPublic,
} from './visibility.ts'

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

describe('dashboardVisibilityOf', () => {
  test('is_private wins over is_public; otherwise is_public decides', () => {
    expect(dashboardVisibilityOf({ is_private: true, is_public: false })).toBe('private')
    expect(dashboardVisibilityOf({ is_private: true, is_public: true })).toBe('private')
    expect(dashboardVisibilityOf({ is_private: false, is_public: true })).toBe('public')
    expect(dashboardVisibilityOf({ is_private: false, is_public: false })).toBe('unlisted')
  })
})

describe('dashboardVisibilityToFlags', () => {
  test('maps each visibility to both flags', () => {
    expect(dashboardVisibilityToFlags('private')).toEqual({ is_private: true, is_public: false })
    expect(dashboardVisibilityToFlags('unlisted')).toEqual({ is_private: false, is_public: false })
    expect(dashboardVisibilityToFlags('public')).toEqual({ is_private: false, is_public: true })
  })

  test('round-trips every visibility', () => {
    for (const visibility of ['private', 'unlisted', 'public'] as const) {
      expect(dashboardVisibilityOf(dashboardVisibilityToFlags(visibility))).toBe(visibility)
    }
  })
})
