import type { ActivityFeatures, DeductionRule } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import {
  applyCategory,
  categoryReasons,
  removeCategoriesOfNonCategorisingRule,
} from './deduction-category.ts'

const rule = { id: 'rule-1', output_category: 'low_hr' }
const own = (reasons: string[] = ['r']) => ({ category: 'low_hr', reasons, rule_id: 'rule-1' })

describe('applyCategory', () => {
  test('appends the rule entry when wanted', () => {
    expect(applyCategory({}, rule, true, ['r'])).toEqual({ run_categories: [own()] })
  })

  test('changes nothing when not wanted and the rule has no entry', () => {
    expect(applyCategory({}, rule, false, [])).toBeNull()
    expect(applyCategory({ run_categories: [] }, rule, false, [])).toBeNull()
  })

  test('changes nothing when the entry is already there, whatever its key order', () => {
    const stored = { reasons: ['r'], rule_id: 'rule-1', category: 'low_hr' }
    expect(applyCategory({ run_categories: [stored] }, rule, true, ['r'])).toBeNull()
  })

  test('updates the reasons in place, keeping the other entries and their order', () => {
    const manual = { category: 'race', reasons: ['by hand'] }
    const other = { category: 'long', reasons: [], rule_id: 'rule-2' }
    expect(applyCategory({ run_categories: [own(['old']), manual, other] }, rule, true, ['new'])).toEqual({
      run_categories: [own(['new']), manual, other],
    })
  })

  test('removes only its own entries when no longer wanted', () => {
    const manual = { category: 'low_hr', reasons: [] }
    const other = { category: 'long', reasons: [], rule_id: 'rule-2' }
    expect(applyCategory({ run_categories: [manual, own(), other, own()] }, rule, false, [])).toEqual({
      run_categories: [manual, other],
    })
  })

  test('drops a duplicate own entry while keeping the first', () => {
    expect(applyCategory({ run_categories: [own(), own()] }, rule, true, ['r'])).toEqual({
      run_categories: [own()],
    })
  })

  test('never adds an excluded category, and removes its own entry for it', () => {
    expect(applyCategory({ run_categories_excluded: ['low_hr'] }, rule, true, ['r'])).toBeNull()
    expect(
      applyCategory({ run_categories: [own()], run_categories_excluded: ['low_hr'] }, rule, true, ['r']),
    ).toEqual({ run_categories: [] })
  })

  test('a category set by hand is not added again, and an own entry for it is removed', () => {
    const manual = { category: 'low_hr', reasons: [] }
    expect(applyCategory({ run_categories: [manual] }, rule, true, ['r'])).toBeNull()
    expect(applyCategory({ run_categories: [manual, own()] }, rule, true, ['r'])).toEqual({
      run_categories: [manual],
    })
    const otherManual = { category: 'race', reasons: [] }
    expect(applyCategory({ run_categories: [otherManual] }, rule, true, ['r'])).toEqual({
      run_categories: [otherManual, own()],
    })
  })

  test('treats a malformed run_categories as empty', () => {
    expect(applyCategory({ run_categories: 'low_hr' }, rule, true, ['r'])).toEqual({
      run_categories: [own()],
    })
  })

  test('does nothing for a rule without output_category', () => {
    expect(applyCategory({}, { id: 'rule-1' }, true, ['r'])).toBeNull()
  })
})

describe('categoryReasons', () => {
  const conditions: DeductionRule['conditions'] = [
    {
      activity_type: 'running',
      feature: 'low_hr_fraction',
      kind: 'activity_feature',
      operator: 'gte',
      value: 0.85,
    },
    { activity_type: 'running', feature: 'moving_s', kind: 'activity_feature', operator: 'gt', value: 5400 },
    {
      activity_type: 'running',
      feature: 'work_block_median_s',
      kind: 'activity_feature',
      operator: 'lt',
      value: 1200,
    },
    { activity_type: 'running', feature: 'pace_cv', kind: 'activity_feature', operator: 'lte', value: 0.15 },
    { activity_type: 'running', kind: 'activity' },
  ]

  test('one line per feature condition with the activity value', () => {
    const features = {
      low_hr_fraction: 0.912,
      moving_s: 6000,
      pace_cv: 0.1234,
      work_block_median_s: 45,
    } as unknown as ActivityFeatures
    expect(categoryReasons({ conditions }, features)).toEqual([
      'time at or below the low-HR ceiling 91.2% ≥ 85.0%',
      'moving time 1:40 > 1:30',
      'median work block 45 s < 20 min',
      'pace variability 0.12 ≤ 0.15',
    ])
  })

  test('fractions keep one decimal, so a near miss does not read as the threshold', () => {
    const features = { low_hr_fraction: 0.849 } as unknown as ActivityFeatures
    expect(categoryReasons({ conditions: [conditions[0]!] }, features)).toEqual([
      'time at or below the low-HR ceiling 84.9% ≥ 85.0%',
    ])
  })

  test('without features, only the comparison', () => {
    expect(categoryReasons({ conditions }, null)).toEqual([
      'time at or below the low-HR ceiling ≥ 85.0%',
      'moving time > 1:30',
      'median work block < 20 min',
      'pace variability ≤ 0.15',
    ])
  })
})

describe('removeCategoriesOfNonCategorisingRule', () => {
  test.each([
    ['no category', { id: 'r', mode: 'enrich' as const }, true],
    ['create mode', { id: 'r', mode: 'create' as const, output_category: 'low_hr' }, true],
    ['default mode', { id: 'r', output_category: 'low_hr' }, true],
    [
      'an enrich rule with a category',
      { id: 'r', mode: 'enrich' as const, output_category: 'low_hr' },
      false,
    ],
  ])('%s → removes: %s', async (_label, updated, removes) => {
    const remove = vi.fn().mockResolvedValue(3)
    expect(await removeCategoriesOfNonCategorisingRule('user', updated, remove)).toBe(removes ? 3 : 0)
    if (removes) expect(remove).toHaveBeenCalledExactlyOnceWith('user', 'r')
    else expect(remove).not.toHaveBeenCalled()
  })
})
