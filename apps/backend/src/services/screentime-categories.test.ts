import { describe, expect, test } from 'vitest'
import type { ScreentimeCategory } from '../db/types'
import {
  compileRules,
  convertAwCategories,
  getColorForCategory,
  getScoreForCategory,
  resolveCategory,
} from './screentime-categories'

// ============================================================================
// Test fixtures
// ============================================================================

const makeCategory = (
  partial: Partial<ScreentimeCategory> & Pick<ScreentimeCategory, 'name'>,
): ScreentimeCategory => ({
  color: undefined,
  created_at: new Date(),
  id: `id-${partial.name.join('-')}`,
  ignore_case: true,
  rule_regex: undefined,
  rule_type: 'none',
  score: undefined,
  sort_order: 0,
  updated_at: new Date(),
  ...partial,
})

const sampleCategories: ScreentimeCategory[] = [
  makeCategory({
    color: '#22c55e',
    name: ['Work'],
    rule_regex: 'Google Docs|libreoffice',
    rule_type: 'regex',
    score: 2,
  }),
  makeCategory({
    name: ['Work', 'Programming'],
    rule_regex: 'GitHub|Stack Overflow|vscode|Visual Studio Code',
    rule_type: 'regex',
  }),
  makeCategory({
    name: ['Work', 'Programming', 'ActivityWatch'],
    rule_regex: 'ActivityWatch|aw-',
    rule_type: 'regex',
  }),
  makeCategory({
    color: '#ef4444',
    name: ['Media'],
    rule_type: 'none',
    score: -1,
  }),
  makeCategory({
    color: '#f97316',
    name: ['Media', 'Games'],
    rule_regex: 'Minecraft|Steam',
    rule_type: 'regex',
  }),
  makeCategory({
    name: ['Media', 'Video'],
    rule_regex: 'YouTube|Netflix|VLC',
    rule_type: 'regex',
  }),
  makeCategory({
    color: '#eab308',
    name: ['Media', 'Social Media'],
    rule_regex: 'reddit|Facebook|Twitter',
    rule_type: 'regex',
    score: -2,
  }),
]

// ============================================================================
// compileRules
// ============================================================================

describe('compileRules', () => {
  test('only compiles categories with regex rules', () => {
    const rules = compileRules(sampleCategories)
    // Media has rule_type 'none', should be excluded
    expect(rules.length).toBe(6)
    expect(rules.every((r) => r.category.rule_type === 'regex')).toBe(true)
  })

  test('respects ignore_case flag', () => {
    const caseCategories = [
      makeCategory({
        ignore_case: true,
        name: ['CaseInsensitive'],
        rule_regex: 'test',
        rule_type: 'regex',
      }),
      makeCategory({
        ignore_case: false,
        name: ['CaseSensitive'],
        rule_regex: 'Test',
        rule_type: 'regex',
      }),
    ]
    const rules = compileRules(caseCategories)
    expect(rules[0].regex.flags).toContain('i')
    expect(rules[1].regex.flags).not.toContain('i')
  })

  test('returns empty for categories with no regex rules', () => {
    const noRuleCategories = [makeCategory({ name: ['NoRule'], rule_type: 'none' })]
    expect(compileRules(noRuleCategories)).toEqual([])
  })
})

// ============================================================================
// resolveCategory
// ============================================================================

describe('resolveCategory', () => {
  const compiled = compileRules(sampleCategories)

  test('matches by activity name', () => {
    expect(resolveCategory('vscode', null, compiled)).toEqual(['Work', 'Programming'])
  })

  test('matches by window title', () => {
    expect(resolveCategory('firefox', 'GitHub - Pull Requests', compiled)).toEqual(['Work', 'Programming'])
  })

  test('returns deepest match when multiple match', () => {
    // "aw-watcher" matches both Programming (via GitHub? no) and ActivityWatch
    expect(resolveCategory('aw-watcher-window', null, compiled)).toEqual([
      'Work',
      'Programming',
      'ActivityWatch',
    ])
  })

  test('returns null when nothing matches', () => {
    expect(resolveCategory('slack', null, compiled)).toBeNull()
  })

  test('matches case-insensitively by default', () => {
    expect(resolveCategory('VSCODE', null, compiled)).toEqual(['Work', 'Programming'])
  })

  test('matches activity containing the pattern', () => {
    expect(resolveCategory('org.videolan.vlc', null, compiled)).toEqual(['Media', 'Video'])
  })

  test('prefers deeper match over shallower', () => {
    // "reddit" matches Social Media (depth 2) which is deeper than Media (depth 1, no rule anyway)
    expect(resolveCategory('reddit', null, compiled)).toEqual(['Media', 'Social Media'])
  })

  test('handles empty title gracefully', () => {
    expect(resolveCategory('vscode', '', compiled)).toEqual(['Work', 'Programming'])
  })

  test('handles undefined title', () => {
    expect(resolveCategory('vscode', undefined, compiled)).toEqual(['Work', 'Programming'])
  })
})

// ============================================================================
// getColorForCategory
// ============================================================================

describe('getColorForCategory', () => {
  test('returns exact match color', () => {
    expect(getColorForCategory(['Work'], sampleCategories)).toBe('#22c55e')
  })

  test('returns parent color when child has no color', () => {
    // Work > Programming has no color; Work has #22c55e
    expect(getColorForCategory(['Work', 'Programming'], sampleCategories)).toBe('#22c55e')
  })

  test('returns grandparent color when intermediate has no color', () => {
    // Work > Programming > ActivityWatch → Programming has no color → Work has #22c55e
    expect(getColorForCategory(['Work', 'Programming', 'ActivityWatch'], sampleCategories)).toBe('#22c55e')
  })

  test('returns child color when set directly', () => {
    expect(getColorForCategory(['Media', 'Games'], sampleCategories)).toBe('#f97316')
  })

  test('returns undefined when no color in hierarchy', () => {
    // Non-existent path
    expect(getColorForCategory(['Unknown'], sampleCategories)).toBeUndefined()
  })

  test('returns parent color for Video (no own color)', () => {
    // Media > Video has no color; Media has #ef4444
    expect(getColorForCategory(['Media', 'Video'], sampleCategories)).toBe('#ef4444')
  })
})

// ============================================================================
// getScoreForCategory
// ============================================================================

describe('getScoreForCategory', () => {
  test('returns exact match score', () => {
    expect(getScoreForCategory(['Work'], sampleCategories)).toBe(2)
  })

  test('inherits parent score when child has none', () => {
    // Work > Programming has no score; Work has 2
    expect(getScoreForCategory(['Work', 'Programming'], sampleCategories)).toBe(2)
  })

  test('returns child-specific score over parent', () => {
    // Media > Social Media has score -2, overriding Media's -1
    expect(getScoreForCategory(['Media', 'Social Media'], sampleCategories)).toBe(-2)
  })

  test('returns parent score for Games (no own score)', () => {
    expect(getScoreForCategory(['Media', 'Games'], sampleCategories)).toBe(-1)
  })

  test('returns undefined for unknown path', () => {
    expect(getScoreForCategory(['Unknown'], sampleCategories)).toBeUndefined()
  })

  test('handles zero score correctly (not falsy)', () => {
    const withZero = [...sampleCategories, makeCategory({ name: ['Comms'], score: 0 })]
    expect(getScoreForCategory(['Comms'], withZero)).toBe(0)
  })
})

// ============================================================================
// convertAwCategories
// ============================================================================

describe('convertAwCategories', () => {
  test('converts AW categories to create body format', () => {
    const awCategories = [
      {
        data: { color: '#ff0000', score: 2 },
        name: ['Work'],
        rule: { ignore_case: true, regex: 'vscode', type: 'regex' as const },
      },
      {
        name: ['Work', 'Programming'],
        rule: { regex: 'GitHub', type: 'regex' as const },
      },
    ]

    const result = convertAwCategories(awCategories)
    expect(result).toHaveLength(2)

    expect(result[0]).toEqual({
      color: '#ff0000',
      ignore_case: true,
      name: ['Work'],
      rule_regex: 'vscode',
      rule_type: 'regex',
      score: 2,
      sort_order: 0,
    })

    expect(result[1]).toEqual({
      color: undefined,
      ignore_case: true, // default
      name: ['Work', 'Programming'],
      rule_regex: 'GitHub',
      rule_type: 'regex',
      score: undefined,
      sort_order: 1,
    })
  })

  test('filters out Uncategorized', () => {
    const awCategories = [
      {
        name: ['Uncategorized'],
        rule: { type: null },
      },
      {
        name: ['Work'],
        rule: { regex: 'code', type: 'regex' as const },
      },
    ]

    const result = convertAwCategories(awCategories)
    expect(result).toHaveLength(1)
    expect(result[0].name).toEqual(['Work'])
  })

  test('converts none-type rules correctly', () => {
    const awCategories = [
      {
        name: ['Media'],
        rule: { type: 'none' as const },
      },
    ]

    const result = convertAwCategories(awCategories)
    expect(result[0].rule_type).toBe('none')
    expect(result[0].rule_regex).toBeUndefined()
  })

  test('handles null rule type', () => {
    const awCategories = [
      {
        name: ['Other'],
        rule: { type: null },
      },
    ]

    const result = convertAwCategories(awCategories)
    expect(result[0].rule_type).toBe('none')
  })
})
