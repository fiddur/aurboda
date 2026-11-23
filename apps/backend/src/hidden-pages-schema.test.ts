import {
  HIDEABLE_MENU_PATHS,
  hiddenPagesSchema,
  keepHideableMenuPaths,
  MENU_ALWAYS_SHOWN,
  updateSettingsInputSchema,
  userSettingsResponseSchema,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

describe('hiddenPagesSchema', () => {
  test('accepts menu paths, including ones no menu knows', () => {
    expect(hiddenPagesSchema.safeParse(['/meals', '/strength', '/no-such-page']).success).toBe(true)
    expect(hiddenPagesSchema.safeParse([]).success).toBe(true)
  })

  test.each([
    ['a path without a leading slash', ['meals']],
    ['a path over 200 characters', [`/${'a'.repeat(200)}`]],
    ['more than 200 paths', Array.from({ length: 201 }, (_, i) => `/p${i}`)],
    ['a non-string entry', [42]],
  ])('rejects %s', (_label, value) => {
    expect(hiddenPagesSchema.safeParse(value).success).toBe(false)
  })

  test('is optional and nullable in the update body', () => {
    expect(updateSettingsInputSchema.safeParse({}).success).toBe(true)
    expect(updateSettingsInputSchema.safeParse({ hidden_pages: null }).success).toBe(true)
    expect(updateSettingsInputSchema.safeParse({ hidden_pages: ['/meals'] }).data?.hidden_pages).toEqual([
      '/meals',
    ])
    expect(updateSettingsInputSchema.safeParse({ hidden_pages: ['meals'] }).success).toBe(false)
  })

  test('defaults to an empty list in the response', () => {
    const parsed = userSettingsResponseSchema.pick({ hidden_pages: true }).parse({})
    expect(parsed.hidden_pages).toEqual([])
  })
})

describe('keepHideableMenuPaths', () => {
  test('keeps menu links and the app-only pages, in order and once', () => {
    expect(keepHideableMenuPaths(['/strength', '/add', '/audit-log', '/strength'])).toEqual([
      '/strength',
      '/add',
      '/audit-log',
    ])
  })

  test('drops paths no menu offers a switch for', () => {
    expect(
      keepHideableMenuPaths(['/data-sources/oura', '/no-such-page', '/', '/admin', '/admin/users']),
    ).toEqual([])
  })

  test('never lists a path that is always shown', () => {
    for (const path of MENU_ALWAYS_SHOWN) expect(HIDEABLE_MENU_PATHS).not.toContain(path)
  })
})
