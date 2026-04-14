import { describe, expect, it } from 'vitest'

import { isEmoji, resolveItemIcon } from './emojiLookup'

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

  it('falls back to defaults for meal types', () => {
    expect(resolveItemIcon('meal:breakfast', {})).toBe('🍳')
  })

  it('falls back to defaults case-insensitively for meal types', () => {
    expect(resolveItemIcon('meal:Breakfast', {})).toBe('🍳')
  })

  it('returns undefined when no match found', () => {
    expect(resolveItemIcon('exercise:Unknown Sport', {})).toBeUndefined()
  })

  it('prefers user icon over default', () => {
    expect(resolveItemIcon('meal:breakfast', { 'meal:breakfast': '🥞' })).toBe('🥞')
  })
})

describe('isEmoji', () => {
  it('recognizes simple emoji', () => {
    expect(isEmoji('☕')).toBe(true)
    expect(isEmoji('🍽️')).toBe(true)
    expect(isEmoji('🧘')).toBe(true)
  })

  it('recognizes ZWJ sequences', () => {
    expect(isEmoji('👨‍💻')).toBe(true)
    expect(isEmoji('🏃‍♂️')).toBe(true)
  })

  it('recognizes ZWJ sequences with skin tone modifiers', () => {
    expect(isEmoji('👨🏻‍💻')).toBe(true)
    expect(isEmoji('👩🏽‍🔬')).toBe(true)
  })

  it('recognizes emoji with skin tone modifier (no ZWJ)', () => {
    expect(isEmoji('👋🏻')).toBe(true)
  })

  it('rejects plain text', () => {
    expect(isEmoji('hello')).toBe(false)
    expect(isEmoji('abc')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isEmoji('')).toBe(false)
  })

  it('rejects mixed text and emoji', () => {
    expect(isEmoji('hello 🍽️')).toBe(false)
    expect(isEmoji('🍽️ food')).toBe(false)
  })
})
