import {
  addActivityBodySchema,
  addPersonBodySchema,
  addPersonDateBodySchema,
  entityTypeSchema,
  formatBirthDate,
  importantDatesQuerySchema,
  isValidMonthDay,
  notesSearchRootTypes,
  parseBirthDate,
  personPostsQuerySchema,
  updateActivityBodySchema,
  updatePersonBodySchema,
  updatePersonDateBodySchema,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

describe('birth dates', () => {
  test('parse YYYY-MM-DD and --MM-DD, and only real dates', () => {
    expect(parseBirthDate('1990-04-12')).toEqual({ day: 12, month: 4, year: 1990 })
    expect(parseBirthDate('--02-29')).toEqual({ day: 29, month: 2, year: null })
    expect(parseBirthDate('2000-02-29')).toEqual({ day: 29, month: 2, year: 2000 })
    for (const bad of [
      '1990-02-29',
      '--02-30',
      '1990-13-01',
      '--04-31',
      '0000-01-01',
      '90-01-01',
      '04-12',
      '',
    ]) {
      expect(parseBirthDate(bad)).toBeNull()
    }
  })

  test('format back to the same strings', () => {
    expect(formatBirthDate({ day: 5, month: 3, year: 1990 })).toBe('1990-03-05')
    expect(formatBirthDate({ day: 29, month: 2, year: null })).toBe('--02-29')
  })

  test('isValidMonthDay allows 29 February only in a leap year or without one', () => {
    expect(isValidMonthDay(2, 29, null)).toBe(true)
    expect(isValidMonthDay(2, 29, 2024)).toBe(true)
    expect(isValidMonthDay(2, 29, 1900)).toBe(false)
    expect(isValidMonthDay(4, 31)).toBe(false)
    expect(isValidMonthDay(0, 1)).toBe(false)
  })
})

describe('person bodies', () => {
  test('a name is required, trimmed and at most 120 characters', () => {
    expect(addPersonBodySchema.parse({ name: '  Anna  ' }).name).toBe('Anna')
    expect(addPersonBodySchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(addPersonBodySchema.safeParse({ name: 'x'.repeat(121) }).success).toBe(false)
  })

  test('limits on relationship, pronouns, notice and handle', () => {
    expect(addPersonBodySchema.safeParse({ name: 'A', relationship: 'x'.repeat(61) }).success).toBe(false)
    expect(addPersonBodySchema.safeParse({ name: 'A', pronouns: 'x'.repeat(41) }).success).toBe(false)
    expect(addPersonBodySchema.safeParse({ birthday_notify_days_before: 61, name: 'A' }).success).toBe(false)
    expect(addPersonBodySchema.safeParse({ birthday_notify_days_before: 0, name: 'A' }).success).toBe(true)
    expect(addPersonBodySchema.safeParse({ handle: '@anna@example.social', name: 'A' }).success).toBe(true)
    expect(addPersonBodySchema.safeParse({ handle: 'anna@example.social', name: 'A' }).success).toBe(true)
    expect(addPersonBodySchema.safeParse({ handle: 'anna', name: 'A' }).success).toBe(false)
    expect(addPersonBodySchema.safeParse({ birth_date: '2027-02-29', name: 'A' }).success).toBe(false)
  })

  test('an update needs at least one field and takes null to clear', () => {
    expect(updatePersonBodySchema.safeParse({}).success).toBe(false)
    expect(updatePersonBodySchema.safeParse({ birth_date: null, handle: null }).success).toBe(true)
  })
})

describe('person date bodies', () => {
  test('a real month and day, 29 February only with a leap year or none', () => {
    expect(addPersonDateBodySchema.safeParse({ day: 29, label: 'x', month: 2 }).success).toBe(true)
    expect(addPersonDateBodySchema.safeParse({ day: 29, label: 'x', month: 2, year: 2027 }).success).toBe(
      false,
    )
    expect(addPersonDateBodySchema.safeParse({ day: 31, label: 'x', month: 6 }).success).toBe(false)
    expect(addPersonDateBodySchema.safeParse({ day: 1, kind: 'wedding', label: 'x', month: 6 }).success).toBe(
      false,
    )
    expect(addPersonDateBodySchema.safeParse({ day: 1, label: ' ', month: 6 }).success).toBe(false)
    expect(
      addPersonDateBodySchema.safeParse({ day: 1, label: 'x', month: 6, notify_days_before: 61 }).success,
    ).toBe(false)
  })

  test('an update needs at least one field', () => {
    expect(updatePersonDateBodySchema.safeParse({}).success).toBe(false)
    expect(updatePersonDateBodySchema.safeParse({ year: null }).success).toBe(true)
  })
})

describe('queries', () => {
  test('important dates take dates; posts take a limit up to 50', () => {
    expect(importantDatesQuerySchema.safeParse({ from: '2026-01-01' }).success).toBe(true)
    expect(importantDatesQuerySchema.safeParse({ from: 'soon' }).success).toBe(false)
    expect(personPostsQuerySchema.parse({ limit: '5' }).limit).toBe(5)
    expect(personPostsQuerySchema.safeParse({ limit: '51' }).success).toBe(false)
  })
})

describe('activity people', () => {
  test('at most 20, unique, on add and update', () => {
    const base = { activity_type: 'walking', start_time: '2026-11-01T10:00:00Z' }
    expect(addActivityBodySchema.safeParse({ ...base, people: ['a', 'b'] }).success).toBe(true)
    expect(addActivityBodySchema.safeParse({ ...base, people: ['a', 'a'] }).success).toBe(false)
    expect(
      addActivityBodySchema.safeParse({ ...base, people: Array.from({ length: 21 }, (_, i) => `${i}`) })
        .success,
    ).toBe(false)
    expect(updateActivityBodySchema.safeParse({ people: [] }).success).toBe(true)
  })
})

describe('person notes', () => {
  test('person is an entity type, read through the person rather than searched', () => {
    expect(entityTypeSchema.safeParse('person').success).toBe(true)
    expect(notesSearchRootTypes).not.toContain('person')
  })
})
