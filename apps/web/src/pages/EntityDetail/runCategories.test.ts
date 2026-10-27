import { describe, expect, test } from 'vitest'

import { addCategory, groupedRunCategories, isRunType, removeCategory, runCategories } from './runCategories'

const ruleId = '00000000-0000-4000-8000-000000000001'
const data = {
  run_categories: [
    { category: 'low_hr', reasons: ['low_hr_fraction ≥ 0.8'], rule_id: ruleId },
    { category: 'hill', reasons: ['added by hand'] },
  ],
  run_categories_excluded: ['tempo'],
}

describe('runCategories', () => {
  test('ignores malformed entries and missing data', () => {
    expect(
      runCategories({ run_categories: [{ category: 'x', reasons: [] }, 'bad', { reasons: [] }] }),
    ).toEqual([{ category: 'x', reasons: [] }])
    expect(runCategories(undefined)).toEqual([])
  })
})

describe('removeCategory', () => {
  test('a rule-set category is removed and excluded', () => {
    expect(removeCategory(data, 'low_hr')).toEqual({
      run_categories: [{ category: 'hill', reasons: ['added by hand'] }],
      run_categories_excluded: ['tempo', 'low_hr'],
    })
  })

  test('a category set both by hand and by a rule is removed entirely and excluded', () => {
    const both = {
      run_categories: [
        { category: 'long', reasons: ['added by hand'] },
        { category: 'long', reasons: ['elapsed ≥ 90 min'], rule_id: ruleId },
      ],
    }
    expect(removeCategory(both, 'long')).toEqual({ run_categories: [], run_categories_excluded: ['long'] })
  })

  test('a hand-set category is only removed', () => {
    expect(removeCategory(data, 'hill')).toEqual({
      run_categories: [data.run_categories[0]],
      run_categories_excluded: ['tempo'],
    })
  })
})

describe('addCategory', () => {
  test('adds a hand-set category and lifts its exclusion', () => {
    expect(addCategory(data, 'tempo')).toEqual({
      run_categories: [...data.run_categories, { category: 'tempo', reasons: ['added by hand'] }],
      run_categories_excluded: [],
    })
  })

  test('does not duplicate an existing category', () => {
    expect(addCategory(data, 'hill').run_categories).toEqual(data.run_categories)
  })

  test('works on an activity without categories', () => {
    expect(addCategory({}, 'long')).toEqual({
      run_categories: [{ category: 'long', reasons: ['added by hand'] }],
      run_categories_excluded: [],
    })
  })
})

describe('groupedRunCategories', () => {
  test('one group per name, reasons merged without repeats', () => {
    expect(
      groupedRunCategories({
        run_categories: [
          { category: 'long', reasons: ['added by hand'] },
          { category: 'low_hr', reasons: ['a'], rule_id: ruleId },
          { category: 'long', reasons: ['elapsed ≥ 90 min', 'added by hand'], rule_id: ruleId },
        ],
      }),
    ).toEqual([
      { category: 'long', from_rule: true, reasons: ['added by hand', 'elapsed ≥ 90 min'] },
      { category: 'low_hr', from_rule: true, reasons: ['a'] },
    ])
  })
})

describe('isRunType', () => {
  const defs = [
    { name: 'running', parent_type: 'exercise' },
    { name: 'trail_running', parent_type: 'running' },
    { name: 'loop_a', parent_type: 'loop_b' },
    { name: 'loop_b', parent_type: 'loop_a' },
  ]

  test('running and its descendants, nothing else, and no hang on a cycle', () => {
    expect(isRunType('running', defs)).toBe(true)
    expect(isRunType('trail_running', defs)).toBe(true)
    expect(isRunType('cycling', defs)).toBe(false)
    expect(isRunType('loop_a', defs)).toBe(false)
    expect(isRunType('running', undefined)).toBe(true)
  })
})
