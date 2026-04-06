import { describe, expect, test } from 'vitest'

import { toPgArray } from './productivity.ts'

describe('toPgArray', () => {
  test('converts single-element array', () => {
    expect(toPgArray(['TV'])).toBe('{TV}')
  })

  test('converts multi-element array (hierarchical category path)', () => {
    expect(toPgArray(['Work', 'Programming'])).toBe('{Work,Programming}')
  })

  test('converts deeply nested category path', () => {
    expect(toPgArray(['Work', 'Programming', 'ActivityWatch'])).toBe('{Work,Programming,ActivityWatch}')
  })

  test('returns null for null input', () => {
    expect(toPgArray(null)).toBeNull()
  })

  test('returns null for undefined input', () => {
    expect(toPgArray(undefined)).toBeNull()
  })

  test('quotes elements containing commas', () => {
    expect(toPgArray(['a,b', 'c'])).toBe('{"a,b",c}')
  })

  test('quotes elements containing double quotes', () => {
    expect(toPgArray(['has "quotes"'])).toBe('{"has \\"quotes\\""}')
  })

  test('quotes elements containing backslashes', () => {
    expect(toPgArray(['back\\slash'])).toBe('{"back\\\\slash"}')
  })

  test('quotes elements containing spaces', () => {
    expect(toPgArray(['Social Media'])).toBe('{"Social Media"}')
  })

  test('quotes empty string elements', () => {
    expect(toPgArray([''])).toBe('{""}')
  })

  test('quotes elements containing curly braces', () => {
    expect(toPgArray(['{nested}'])).toBe('{"{nested}"}')
  })

  test('quotes NULL keyword to avoid ambiguity', () => {
    expect(toPgArray(['NULL'])).toBe('{"NULL"}')
  })

  test('handles empty array', () => {
    expect(toPgArray([])).toBe('{}')
  })

  test('handles mixed simple and complex elements', () => {
    expect(toPgArray(['Media', 'Social Media'])).toBe('{Media,"Social Media"}')
  })
})
