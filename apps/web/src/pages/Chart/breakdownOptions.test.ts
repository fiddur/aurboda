import { describe, expect, test } from 'vitest'

import { breakdownOptions } from './breakdownOptions'

const typeDef = {
  data_schema: { fields: [{ is_categorical: true, label: 'Mood', name: 'mood', type: 'string' as const }] },
}
const state = { breakdown_fields: [], filter_field: '', filter_value: '', measure: '' as const }

describe('breakdownOptions', () => {
  test('With comes first when the account has people', () => {
    expect(breakdownOptions(typeDef, state, true)).toEqual([
      { label: 'With', name: '@people' },
      { label: 'Mood', name: 'mood' },
    ])
  })

  test('no With without people', () => {
    expect(breakdownOptions(typeDef, state, false)).toEqual([{ label: 'Mood', name: 'mood' }])
  })

  test('With stays when the chart already breaks down by it, and needs no categorical field', () => {
    expect(
      breakdownOptions({ data_schema: { fields: [] } }, { ...state, breakdown_fields: ['@people'] }, false),
    ).toEqual([{ label: 'With', name: '@people' }])
  })
})
