import { describe, expect, test } from 'vitest'

import { foldedIncludes, foldedStartsWith, searchFold } from './searchFold'

describe('searchFold', () => {
  test('drops accents and case', () => {
    expect(searchFold('Thérèse')).toBe('therese')
    expect(searchFold('ÅSA Öberg')).toBe('asa oberg')
    expect(searchFold('François Müller')).toBe('francois muller')
  })

  test('folds letters that do not decompose', () => {
    expect(searchFold('Bjørn Ærø')).toBe('bjorn aero')
    expect(searchFold('Łukasz Strauß')).toBe('lukasz strauss')
  })

  test('folds what was typed the same way, so an accented query still matches', () => {
    expect(foldedStartsWith('Thérèse', searchFold('The'))).toBe(true)
    expect(foldedStartsWith('Therese', searchFold('Thé'))).toBe(true)
    expect(foldedIncludes('Anna-Thérèse', searchFold('therese'))).toBe(true)
    expect(foldedIncludes(null, 'a')).toBe(false)
  })
})
