import { describe, expect, test } from 'vitest'

import { indexToLabel, maskBreakdownNames } from './breakdown-mask.ts'

describe('indexToLabel', () => {
  test('letters the first 26 as A–Z', () => {
    expect(indexToLabel(0)).toBe('A')
    expect(indexToLabel(1)).toBe('B')
    expect(indexToLabel(25)).toBe('Z')
  })

  test('rolls over to AA, AB after Z', () => {
    expect(indexToLabel(26)).toBe('AA')
    expect(indexToLabel(27)).toBe('AB')
    expect(indexToLabel(51)).toBe('AZ')
    expect(indexToLabel(52)).toBe('BA')
  })
})

describe('maskBreakdownNames', () => {
  test('returns an empty map when no masked field is part of the breakdown', () => {
    expect(maskBreakdownNames(['Alice', 'Bob'], ['partner'], []).size).toBe(0)
    expect(maskBreakdownNames(['Alice', 'Bob'], ['partner'], ['mood']).size).toBe(0)
    expect(maskBreakdownNames([], ['partner'], ['partner']).size).toBe(0)
  })

  test('single field: masks values as stable A/B/C in sorted order', () => {
    const map = maskBreakdownNames(['Bob', 'Alice', 'Carol'], ['partner'], ['partner'])
    // Sorted: Alice→A, Bob→B, Carol→C — independent of input order.
    expect(map.get('Alice')).toBe('A')
    expect(map.get('Bob')).toBe('B')
    expect(map.get('Carol')).toBe('C')
  })

  test('multi field: masks only the chosen field, keeps others real', () => {
    const map = maskBreakdownNames(
      ['Alice / happy', 'Bob / sad', 'Alice / sad'],
      ['partner', 'mood'],
      ['partner'],
    )
    expect(map.get('Alice / happy')).toBe('A / happy')
    expect(map.get('Bob / sad')).toBe('B / sad')
    expect(map.get('Alice / sad')).toBe('A / sad')
  })

  test('multi field: can mask several fields at once', () => {
    const map = maskBreakdownNames(['Alice / happy', 'Bob / sad'], ['partner', 'mood'], ['partner', 'mood'])
    expect(map.get('Alice / happy')).toBe('A / A')
    expect(map.get('Bob / sad')).toBe('B / B')
  })

  test('falls back to whole-label masking when a value contains the delimiter', () => {
    // 'A / B' as a single partner value does not split into 1 part → ambiguous.
    const map = maskBreakdownNames(['A / B', 'Carol'], ['partner'], ['partner'])
    // Whole distinct names sorted: 'A / B'→A, 'Carol'→B.
    expect(map.get('A / B')).toBe('A')
    expect(map.get('Carol')).toBe('B')
  })

  test('is a bijection — distinct real names map to distinct masked names', () => {
    const names = ['Alice / gym', 'Alice / home', 'Bob / gym']
    const map = maskBreakdownNames(names, ['partner', 'place'], ['partner'])
    expect(new Set(map.values()).size).toBe(names.length)
  })
})
