import {
  chartDataQuerySchema,
  dataFieldDefinitionSchema,
  dataItemFieldDefinitionSchema,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

describe('dataItemFieldDefinitionSchema', () => {
  test('a catalog is allowed on a plain string item field', () => {
    expect(
      dataItemFieldDefinitionSchema.safeParse({ catalog: 'exercises', name: 'exercise', type: 'string' })
        .success,
    ).toBe(true)
  })

  test('a catalog is rejected on a number field', () => {
    const result = dataItemFieldDefinitionSchema.safeParse({
      catalog: 'exercises',
      name: 'reps',
      type: 'number',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(
      'catalog is only allowed on a string field without enum_values',
    )
    expect(result.error?.issues[0]?.path).toEqual(['catalog'])
  })

  test('a catalog is rejected on a string field with enum_values', () => {
    expect(
      dataItemFieldDefinitionSchema.safeParse({
        catalog: 'exercises',
        enum_values: ['a'],
        name: 'exercise',
        type: 'string',
      }).success,
    ).toBe(false)
  })

  test('a list field rejects an item field with a misplaced catalog', () => {
    expect(
      dataFieldDefinitionSchema.safeParse({
        item_fields: [{ catalog: 'exercises', name: 'reps', type: 'number' }],
        name: 'sets',
        type: 'list',
      }).success,
    ).toBe(false)
  })
})

describe('dataFieldDefinitionSchema', () => {
  const sets = {
    item_fields: [{ name: 'reps', type: 'number' as const }],
    name: 'sets',
    type: 'list' as const,
  }

  test('a list field carries neither enum_values nor unit', () => {
    expect(dataFieldDefinitionSchema.safeParse(sets).success).toBe(true)
    expect(dataFieldDefinitionSchema.safeParse({ ...sets, unit: 'kg' }).success).toBe(false)
    expect(dataFieldDefinitionSchema.safeParse({ ...sets, enum_values: ['a'] }).success).toBe(false)
  })

  test('a scalar field may carry a unit', () => {
    expect(dataFieldDefinitionSchema.safeParse({ name: 'weight', type: 'number', unit: 'kg' }).success).toBe(
      true,
    )
  })
})

describe('chartDataQuerySchema', () => {
  const query = {
    end: '2026-04-01T00:00:00Z',
    pattern: 'strength_training',
    source_type: 'activity_type' as const,
    start: '2026-03-01T00:00:00Z',
  }

  test('a breakdown by an item path needs a measure', () => {
    const result = chartDataQuerySchema.safeParse({ ...query, breakdown_fields: ['sets.exercise'] })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('breaking down by an item path needs a measure')
    expect(
      chartDataQuerySchema.safeParse({ ...query, breakdown_fields: ['sets.exercise'], measure: 'e1rm' })
        .success,
    ).toBe(true)
  })

  test('a scalar breakdown needs no measure', () => {
    expect(chartDataQuerySchema.safeParse({ ...query, breakdown_fields: ['location'] }).success).toBe(true)
  })
})
