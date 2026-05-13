import { describe, expect, test } from 'vitest'

import { generateSlug } from './screentime-category-slug.ts'

const opts = (nonBuiltin: string[] = [], builtin: string[] = []) => ({
  existingNonBuiltin: new Set(nonBuiltin),
  existingBuiltin: new Set(builtin),
})

describe('generateSlug', () => {
  test('uses leaf name slugified', () => {
    expect(generateSlug('TV', null, opts())).toEqual({ slug: 'tv', linkToExisting: false })
  })

  test('handles non-alphanumeric and trim', () => {
    expect(generateSlug('  Hot Bath ', null, opts()).slug).toBe('hot_bath')
    expect(generateSlug('[Work] Meetings', null, opts()).slug).toBe('work_meetings')
  })

  test('returns linkToExisting when a non-builtin type already has that slug', () => {
    expect(generateSlug('TV', null, opts(['tv']))).toEqual({ slug: 'tv', linkToExisting: true })
  })

  test('renames when builtin collides — prefers parent-prefix', () => {
    expect(generateSlug('Screentime', null, opts([], ['screentime']))).toEqual({
      slug: 'screentime_2',
      linkToExisting: false,
    })
    expect(generateSlug('Programming', 'work', opts([], ['programming']))).toEqual({
      slug: 'work_programming',
      linkToExisting: false,
    })
  })

  test('parent-prefix form also converges if non-builtin owns it', () => {
    expect(generateSlug('Programming', 'work', opts(['work_programming'], ['programming']))).toEqual({
      slug: 'work_programming',
      linkToExisting: true,
    })
  })

  test('falls back to numeric suffix when both base and parent-prefix builtin-collide', () => {
    expect(generateSlug('Sleep', 'rest', opts([], ['sleep', 'rest_sleep']))).toEqual({
      slug: 'sleep_2',
      linkToExisting: false,
    })
  })

  test('numeric leaf gets letter prefix', () => {
    expect(generateSlug('123 Test', null, opts()).slug).toBe('t_123_test')
  })

  test('truncates to 100 chars', () => {
    const long = 'a'.repeat(150)
    const result = generateSlug(long, null, opts())
    expect(result.slug.length).toBeLessThanOrEqual(100)
  })

  test('empty slugifies to "unknown"', () => {
    expect(generateSlug('!@#$', null, opts()).slug).toBe('unknown')
  })
})
