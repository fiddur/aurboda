import { describe, expect, it } from 'vitest'

import { resolveItemIcon } from './emojiLookup'

describe('resolveItemIcon', () => {
  it('returns exact match from user icons', () => {
    expect(resolveItemIcon('exercise:Yoga', { 'exercise:Yoga': '🧘‍♀️' })).toBe('🧘‍♀️')
  })

  it('returns case-insensitive match from user icons', () => {
    // ExerciseMeta saves title-cased keys; timeline looks up lowercase
    expect(resolveItemIcon('exercise:running treadmill', { 'exercise:Running Treadmill': '🏃‍♂️' })).toBe('🏃‍♂️')
  })

  it('returns case-insensitive match for single-word exercise types', () => {
    expect(resolveItemIcon('exercise:yoga', { 'exercise:Yoga': '🧘‍♀️' })).toBe('🧘‍♀️')
  })

  it('returns undefined for empty string user icon (explicit clear)', () => {
    expect(resolveItemIcon('exercise:Yoga', { 'exercise:Yoga': '' })).toBeUndefined()
  })

  it('returns undefined for case-insensitive empty string user icon', () => {
    expect(resolveItemIcon('exercise:yoga', { 'exercise:Yoga': '' })).toBeUndefined()
  })

  it('falls back to defaults when no user icon set', () => {
    expect(resolveItemIcon('exercise:Running', {})).toBe('🏃')
  })

  it('falls back to defaults case-insensitively', () => {
    expect(resolveItemIcon('exercise:running', {})).toBe('🏃')
  })

  it('returns undefined when no match found', () => {
    expect(resolveItemIcon('exercise:Unknown Sport', {})).toBeUndefined()
  })

  it('prefers user icon over default', () => {
    expect(resolveItemIcon('exercise:Running', { 'exercise:Running': '🦵' })).toBe('🦵')
  })
})
