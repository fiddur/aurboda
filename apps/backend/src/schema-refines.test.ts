import {
  barChartConfigSchema,
  chartBreakdownError,
  chartDataHttpQuerySchema,
  chartDataQuerySchema,
  chartFilterError,
  combinedChartBarsLayerSchema,
  dataFieldDefinitionSchema,
  dataItemFieldDefinitionSchema,
  goalSchema,
  journalChartError,
  muscleGroupBreakdownPath,
  muscleGroupFilter,
  muscleGroupHistoryPeriod,
  muscleGroupHistoryQuerySchema,
  recordCardConfigSchema,
  storedActivityTypeCatalogEntrySchema,
  trendChartConfigSchema,
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

describe('min and max on a data field', () => {
  test('are accepted on a number field, top level and in a list item', () => {
    expect(
      dataFieldDefinitionSchema.safeParse({ max: 10, min: 0, name: 'severity', type: 'number' }).success,
    ).toBe(true)
    expect(dataItemFieldDefinitionSchema.safeParse({ min: 0, name: 'reps', type: 'number' }).success).toBe(
      true,
    )
  })

  test('are rejected on a string field', () => {
    const result = dataFieldDefinitionSchema.safeParse({ max: 3, name: 'kind', type: 'string' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('min and max are only allowed on a number field')
    expect(result.error?.issues[0]?.path).toEqual(['min'])
    expect(dataItemFieldDefinitionSchema.safeParse({ min: 0, name: 'kind', type: 'string' }).success).toBe(
      false,
    )
  })

  test('are rejected on a list field', () => {
    expect(
      dataFieldDefinitionSchema.safeParse({
        item_fields: [{ name: 'reps', type: 'number' }],
        min: 0,
        name: 'sets',
        type: 'list',
      }).success,
    ).toBe(false)
  })

  test('min above max is rejected', () => {
    const result = dataFieldDefinitionSchema.safeParse({ max: 1, min: 2, name: 'severity', type: 'number' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('min must not be above max')
    expect(
      dataItemFieldDefinitionSchema.safeParse({ max: 1, min: 2, name: 'reps', type: 'number' }).success,
    ).toBe(false)
  })
})

describe('storedActivityTypeCatalogEntrySchema', () => {
  test('parses a catalogue entry', () => {
    expect(
      storedActivityTypeCatalogEntrySchema.safeParse({
        aliases: [],
        color: '#dc2626',
        data_schema: { fields: [{ max: 10, min: 0, name: 'severity', type: 'number' }] },
        display_category: 'health',
        display_name: 'Headache',
        group: 'symptoms',
        icon: '🤕',
        name: 'headache',
        parent_type: 'symptom',
        same_as: { apple_healthkit: ['HKCategoryTypeIdentifierHeadache'] },
      }).success,
    ).toBe(true)
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

  test('a muscle-group breakdown needs a summed measure', () => {
    const muscle = { ...query, breakdown_fields: ['sets.exercise.muscle_group'] }
    expect(chartDataQuerySchema.safeParse({ ...muscle, measure: 'set_count' }).success).toBe(true)
    expect(
      chartDataQuerySchema.safeParse({
        ...muscle,
        breakdown_fields: ['location', 'sets.exercise.muscle_group'],
        measure: 'volume',
      }).success,
    ).toBe(true)
    const e1rm = chartDataQuerySchema.safeParse({ ...muscle, measure: 'e1rm' })
    expect(e1rm.error?.issues.map((i) => i.message)).toEqual([
      'a muscle-group breakdown needs measure set_count, volume or total_reps',
    ])
    expect(chartDataQuerySchema.safeParse(muscle).error?.issues.map((i) => i.message)).toContain(
      'a muscle-group breakdown needs measure set_count, volume or total_reps',
    )
  })

  test('@people is a scalar breakdown: no measure needed, and it combines with an item or muscle-group path', () => {
    expect(chartDataQuerySchema.safeParse({ ...query, breakdown_fields: ['@people'] }).success).toBe(true)
    expect(
      chartDataQuerySchema.safeParse({
        ...query,
        breakdown_fields: ['@people', 'sets.exercise'],
        measure: 'e1rm',
      }).success,
    ).toBe(true)
    expect(
      chartDataQuerySchema.safeParse({
        ...query,
        breakdown_fields: ['@people', 'sets.exercise.muscle_group'],
        measure: 'set_count',
      }).success,
    ).toBe(true)
    expect(chartBreakdownError(['@people'], undefined)).toBeUndefined()
    expect(chartFilterError('sets.exercise.muscle_group', 'chest', ['@people'], 'set_count')).toBeUndefined()
  })

  test('a muscle-group breakdown cannot be combined with another item path', () => {
    const result = chartDataQuerySchema.safeParse({
      ...query,
      breakdown_fields: ['sets.exercise', 'sets.exercise.muscle_group'],
      measure: 'set_count',
    })
    expect(result.error?.issues.map((i) => i.message)).toEqual([
      'a muscle-group breakdown cannot be combined with another item path',
    ])
  })
})

describe('muscleGroupBreakdownPath', () => {
  test('the item path of a three-segment muscle_group field', () => {
    expect(muscleGroupBreakdownPath('sets.exercise.muscle_group')).toBe('sets.exercise')
    expect(muscleGroupBreakdownPath('sets.muscle_group')).toBeUndefined()
    expect(muscleGroupBreakdownPath('sets.exercise')).toBeUndefined()
    expect(muscleGroupBreakdownPath('.exercise.muscle_group')).toBeUndefined()
  })
})

describe('chartBreakdownError', () => {
  test('the message of the first rule broken', () => {
    expect(chartBreakdownError(['sets.exercise.muscle_group'], undefined)).toBe(
      'breaking down by an item path needs a measure',
    )
    expect(chartBreakdownError(['sets.exercise.muscle_group'], 'max_reps')).toBe(
      'a muscle-group breakdown needs measure set_count, volume or total_reps',
    )
    expect(chartBreakdownError(['sets.exercise.muscle_group'], 'total_reps')).toBeUndefined()
  })
})

describe('muscleGroupFilter', () => {
  test('the item path and group of a muscle-group filter', () => {
    expect(muscleGroupFilter('sets.exercise.muscle_group', 'chest')).toEqual({
      group: 'chest',
      path: 'sets.exercise',
    })
  })

  test('undefined for an item or scalar filter, or a value that is not a muscle group key', () => {
    expect(muscleGroupFilter('sets.exercise', 'Bench Press')).toBeUndefined()
    expect(muscleGroupFilter('location', 'Gym')).toBeUndefined()
    expect(muscleGroupFilter('sets.exercise.muscle_group', 'Chest')).toBeUndefined()
    expect(muscleGroupFilter('sets.exercise.muscle_group', undefined)).toBeUndefined()
    expect(muscleGroupFilter(undefined, 'chest')).toBeUndefined()
  })
})

describe('chartDataQuerySchema with a muscle-group filter', () => {
  const query = {
    end: '2026-04-01T00:00:00Z',
    filter_field: 'sets.exercise.muscle_group',
    filter_value: 'chest',
    measure: 'set_count' as const,
    pattern: 'strength_training',
    source_type: 'activity_type' as const,
    start: '2026-03-01T00:00:00Z',
  }
  const messages = (input: Record<string, unknown>) =>
    chartDataQuerySchema.safeParse(input).error?.issues.map((i) => i.message)

  test('accepts a summed measure, alone, by its own item path or by a scalar field', () => {
    expect(chartDataQuerySchema.safeParse(query).success).toBe(true)
    expect(chartDataQuerySchema.safeParse({ ...query, breakdown_fields: ['sets.exercise'] }).success).toBe(
      true,
    )
    expect(
      chartDataQuerySchema.safeParse({ ...query, breakdown_fields: ['location'], measure: 'volume' }).success,
    ).toBe(true)
  })

  test('the value must be a muscle group key', () => {
    expect(messages({ ...query, filter_value: 'Chest' })).toEqual([
      expect.stringContaining('a muscle-group filter_value must be one of chest, shoulders'),
    ])
    expect(messages({ ...query, filter_value: undefined })).toHaveLength(1)
  })

  test('needs a summed measure', () => {
    expect(messages({ ...query, measure: 'e1rm' })).toEqual([
      'a muscle-group filter needs measure set_count, volume or total_reps',
    ])
  })

  test('cannot be combined with a muscle-group breakdown', () => {
    expect(messages({ ...query, breakdown_fields: ['sets.exercise.muscle_group'] })).toEqual([
      'a muscle-group filter cannot be combined with a muscle-group breakdown',
    ])
  })

  test('an item-path breakdown must be the filter’s own item path', () => {
    expect(messages({ ...query, breakdown_fields: ['sets.equipment'] })).toEqual([
      "with a muscle-group filter, an item-path breakdown must be the filter's own item path",
    ])
  })

  test('the field accepts the muscle-group form but no other three-segment path', () => {
    expect(chartDataHttpQuerySchema.safeParse({ ...query }).success).toBe(true)
    expect(chartDataQuerySchema.safeParse({ ...query, filter_field: 'sets.exercise.other' }).success).toBe(
      false,
    )
  })
})

describe('chartFilterError', () => {
  test('the message of the first rule broken', () => {
    expect(chartFilterError('sets.exercise.muscle_group', 'nope', undefined, 'e1rm')).toMatch(
      /^a muscle-group filter_value must be one of/,
    )
    expect(chartFilterError('sets.exercise.muscle_group', 'chest', undefined, 'e1rm')).toBe(
      'a muscle-group filter needs measure set_count, volume or total_reps',
    )
    expect(
      chartFilterError('sets.exercise.muscle_group', 'chest', ['sets.exercise'], 'volume'),
    ).toBeUndefined()
    expect(chartFilterError('sets.exercise', 'Bench Press', ['sets.other'], 'e1rm')).toBeUndefined()
  })
})

describe('dashboard filters', () => {
  const muscle = { filter_field: 'sets.exercise.muscle_group', filter_value: 'chest' }

  test('a bar chart and the bars layer of a combined chart accept the muscle-group filter', () => {
    expect(
      barChartConfigSchema.safeParse({
        ...muscle,
        aggregation: 'sum',
        bucket_size: '1w',
        lookback_days: 90,
        measure: 'set_count',
        pattern: 'strength_training',
        source_type: 'activity_type',
      }).success,
    ).toBe(true)
    expect(
      combinedChartBarsLayerSchema.safeParse({
        ...muscle,
        bucket_size: '1w',
        kind: 'bars',
        measure: 'set_count',
        pattern: 'strength_training',
        source_type: 'activity_type',
      }).success,
    ).toBe(true)
  })

  test('a record card still rejects it', () => {
    expect(
      recordCardConfigSchema.safeParse({
        ...muscle,
        measure: 'e1rm',
        pattern: 'strength_training',
        source_type: 'activity_type',
      }).success,
    ).toBe(false)
  })
})

describe('muscleGroupHistoryQuerySchema', () => {
  test('end defaults to now and start to 90 days before end', () => {
    const now = new Date('2026-04-01T00:00:00Z')
    expect(muscleGroupHistoryPeriod({}, now)).toEqual({ end: now, start: new Date('2026-01-01T00:00:00Z') })
    expect(muscleGroupHistoryPeriod({ end: '2026-03-31T00:00:00Z' }, now)).toEqual({
      end: new Date('2026-03-31T00:00:00Z'),
      start: new Date('2025-12-31T00:00:00Z'),
    })
    expect(muscleGroupHistoryPeriod({ start: '2026-03-01T00:00:00Z' }, now).start).toEqual(
      new Date('2026-03-01T00:00:00Z'),
    )
  })

  test('start must be before end', () => {
    expect(muscleGroupHistoryQuerySchema.safeParse({ field: 'sets.exercise' }).success).toBe(true)
    const result = muscleGroupHistoryQuerySchema.safeParse({
      end: '2026-03-01T00:00:00Z',
      field: 'sets.exercise',
      start: '2026-03-01T00:00:00Z',
    })
    expect(result.error?.issues.map((i) => i.message)).toEqual(['start must be before end'])
  })
})

describe('journalChartError', () => {
  const journal = { source_type: 'journal' }

  test('a journal query with its own fields and filters passes', () => {
    expect(
      journalChartError({
        ...journal,
        aggregation: 'sum',
        breakdown_fields: ['@tags', '@people'],
        journal_entity_types: 'time,day,activity',
        journal_related_id: '00000000-0000-4000-8000-000000000001',
        journal_related_type: 'person',
        journal_tags: 'travel,work',
      }),
    ).toBeUndefined()
  })

  test.each([
    [{ breakdown_fields: ['mood'] }, 'a journal breakdown is @tags or @people'],
    [{ measure: 'e1rm' }, 'measure and filter_field are for activity_type sources'],
    [{ filter_field: 'sets.exercise' }, 'measure and filter_field are for activity_type sources'],
    [{ aggregation: 'mean' }, 'a journal chart counts entries (count) or sums their words (sum)'],
    [{ aggregation: 'max' }, 'a journal chart counts entries (count) or sums their words (sum)'],
    [{ journal_tags: 'not a tag!' }, 'Not a valid tag list (letters, digits and _, comma-separated)'],
    [{ journal_entity_types: 'time,note' }, expect.stringContaining('Not a comment root type: note')],
    [{ journal_related_type: 'person' }, 'related_type and related_id go together'],
  ])('a journal query with %o is refused', (extra, message) => {
    expect(journalChartError({ ...journal, ...extra })).toEqual(message)
  })

  test('the breakdown rule comes first', () => {
    expect(journalChartError({ ...journal, aggregation: 'mean', breakdown_fields: ['mood'] })).toBe(
      'a journal breakdown is @tags or @people',
    )
  })

  test('another source takes no journal filter and no @tags', () => {
    const metric = { pattern: 'weight', source_type: 'metric' }
    expect(journalChartError(metric)).toBeUndefined()
    expect(journalChartError({ ...metric, journal_q: 'sea' })).toBe(
      'journal_* filters need source_type journal',
    )
    expect(journalChartError({ ...metric, breakdown_fields: ['@tags'] })).toBe('@tags is a journal breakdown')
  })

  test('chartDataQuerySchema mirrors it', () => {
    const query = { end: '2026-04-01T00:00:00Z', start: '2026-03-01T00:00:00Z' }
    expect(chartDataQuerySchema.safeParse({ ...query, source_type: 'journal' }).success).toBe(true)
    expect(
      chartDataQuerySchema
        .safeParse({ ...query, aggregation: 'mean', source_type: 'journal' })
        .error?.issues.map((i) => i.message),
    ).toEqual(['a journal chart counts entries (count) or sums their words (sum)'])
    expect(
      chartDataQuerySchema
        .safeParse({ ...query, journal_tags: 'travel', pattern: 'weight', source_type: 'metric' })
        .error?.issues.map((i) => i.message),
    ).toEqual(['journal_* filters need source_type journal'])
  })

  test('a trend goal does not take the journal source', () => {
    const goal = {
      goal_type: 'trend',
      id: '00000000-0000-4000-8000-000000000001',
      min: 1,
      pattern: 'running',
    }
    expect(goalSchema.safeParse({ ...goal, source_type: 'activity_type' }).success).toBe(true)
    expect(goalSchema.safeParse({ ...goal, source_type: 'journal' }).success).toBe(false)
  })
})

describe('dashboard chart configs with the journal source', () => {
  test('a bar chart and a trend chart take it without a pattern, with its filters', () => {
    expect(
      barChartConfigSchema.safeParse({
        breakdown_fields: ['@tags'],
        bucket_size: '1w',
        journal_tags: 'travel',
        lookback_days: 30,
        source_type: 'journal',
      }).success,
    ).toBe(true)
    expect(trendChartConfigSchema.safeParse({ journal_q: 'sea', source_type: 'journal' }).success).toBe(true)
  })

  test('a combined chart bars layer keeps the journal filters', () => {
    const layer = combinedChartBarsLayerSchema.parse({
      bucket_size: '1w',
      journal_tags: 'travel',
      kind: 'bars',
      source_type: 'journal',
    })
    expect(layer.journal_tags).toBe('travel')
  })
})
