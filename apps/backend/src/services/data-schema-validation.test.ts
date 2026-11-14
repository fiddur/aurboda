import type { DataSchemaDefinition } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { strengthTrainingDataSchema } from '../schema/builtin-data-schemas.ts'
import { validateActivityData } from './data-schema-validation.ts'

const schema: DataSchemaDefinition = {
  fields: [
    { name: 'device', type: 'string', label: 'Device' },
    { name: 'display', type: 'string', label: 'Display', enum_values: ['internal', 'external-monitor'] },
    { name: 'brightness', type: 'number', unit: 'cd/m²' },
    { name: 'active', type: 'boolean' },
    { name: 'hostname', type: 'string', required: true },
  ],
}

describe('validateActivityData', () => {
  it('accepts valid data with all fields', () => {
    const result = validateActivityData(
      { active: true, brightness: 300, device: 'spanda', display: 'external-monitor', hostname: 'spanda' },
      schema,
    )
    expect(result).toEqual({ valid: true })
  })

  it('accepts data with only required fields', () => {
    const result = validateActivityData({ hostname: 'spanda' }, schema)
    expect(result).toEqual({ valid: true })
  })

  it('accepts extra fields not in schema', () => {
    const result = validateActivityData({ hostname: 'spanda', unknown_field: 'value' }, schema)
    expect(result).toEqual({ valid: true })
  })

  it('rejects missing required field', () => {
    const result = validateActivityData({ device: 'spanda' }, schema)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Required field "hostname" is missing')
  })

  it('rejects missing required field when data is undefined', () => {
    const result = validateActivityData(undefined, schema)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Required field "hostname" is missing')
  })

  it('rejects wrong type for string field', () => {
    const result = validateActivityData({ device: 123, hostname: 'spanda' }, schema)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Field "device" expected type "string", got "number"')
  })

  it('rejects wrong type for number field', () => {
    const result = validateActivityData({ brightness: 'high', hostname: 'spanda' }, schema)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Field "brightness" expected type "number", got "string"')
  })

  it('rejects wrong type for boolean field', () => {
    const result = validateActivityData({ active: 'yes', hostname: 'spanda' }, schema)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Field "active" expected type "boolean", got "string"')
  })

  it('rejects value not in enum_values', () => {
    const result = validateActivityData({ display: 'hdmi', hostname: 'spanda' }, schema)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Field "display" value "hdmi" is not one of: internal, external-monitor')
  })

  it('accepts valid enum value', () => {
    const result = validateActivityData({ display: 'internal', hostname: 'spanda' }, schema)
    expect(result).toEqual({ valid: true })
  })

  it('collects multiple errors', () => {
    const result = validateActivityData({ brightness: 'high', device: 42 }, schema)
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(3)
  })

  it('skips type check for optional absent fields', () => {
    const schemaAllOptional: DataSchemaDefinition = {
      fields: [{ name: 'count', type: 'number' }],
    }
    const result = validateActivityData({}, schemaAllOptional)
    expect(result).toEqual({ valid: true })
  })

  it('skips type check for null values on optional fields', () => {
    const schemaAllOptional: DataSchemaDefinition = {
      fields: [{ name: 'count', type: 'number' }],
    }
    const result = validateActivityData({ count: null }, schemaAllOptional)
    expect(result).toEqual({ valid: true })
  })
})

describe('validateActivityData with a list field', () => {
  const setsField = {
    item_fields: [
      { name: 'exercise', required: true, type: 'string' as const },
      { name: 'weight', type: 'number' as const, unit: 'kg' },
      { name: 'reps', type: 'number' as const },
      { name: 'time', type: 'number' as const, unit: 's' },
      { enum_values: ['normal', 'warmup'], name: 'set_type', type: 'string' as const },
    ],
    label: 'Sets',
    name: 'sets',
    type: 'list' as const,
  }
  const listSchema: DataSchemaDefinition = { fields: [setsField] }
  const requiredListSchema: DataSchemaDefinition = { fields: [{ ...setsField, required: true }] }

  it('accepts valid sets with nulls on optional keys and extra undeclared item keys', () => {
    const result = validateActivityData(
      {
        sets: [
          { exercise: 'Bench Press', reps: 8, weight: 60 },
          { exercise: 'Bench Press', reps: 8, rpe: 8, time: null, weight: 62.5 },
          { exercise: 'Plank', reps: null, set_type: 'normal', time: 60, weight: null },
        ],
      },
      listSchema,
    )
    expect(result).toEqual({ valid: true })
  })

  it('accepts an absent or null list when not required', () => {
    expect(validateActivityData({}, listSchema)).toEqual({ valid: true })
    expect(validateActivityData({ sets: null }, listSchema)).toEqual({ valid: true })
  })

  it('rejects an absent required list', () => {
    const result = validateActivityData({}, requiredListSchema)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Required field "sets" is missing')
  })

  it('rejects a list value that is not an array', () => {
    const result = validateActivityData({ sets: 'Bench 3x8' }, listSchema)
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(['Field "sets" expected an array, got "string"'])
  })

  it('rejects items that are not objects', () => {
    const result = validateActivityData({ sets: [1, null, ['x']] }, listSchema)
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([
      'Field "sets[0]" expected an object, got "number"',
      'Field "sets[1]" expected an object, got "null"',
      'Field "sets[2]" expected an object, got "array"',
    ])
  })

  it('rejects an item missing a required item field', () => {
    const result = validateActivityData({ sets: [{ exercise: 'Squat', reps: 5 }, { reps: 5 }] }, listSchema)
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(['Required field "sets[1].exercise" is missing'])
  })

  it('rejects a wrong item field type', () => {
    const result = validateActivityData({ sets: [{ exercise: 'Squat', reps: '5' }] }, listSchema)
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(['Field "sets[0].reps" expected type "number", got "string"'])
  })

  it('rejects an item value not in enum_values', () => {
    const result = validateActivityData({ sets: [{ exercise: 'Squat', set_type: 'drop' }] }, listSchema)
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(['Field "sets[0].set_type" value "drop" is not one of: normal, warmup'])
  })

  it('collects errors from several items', () => {
    const result = validateActivityData(
      { sets: [{ reps: 5 }, { exercise: 'Squat', weight: 'heavy' }, 'x'] },
      listSchema,
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([
      'Required field "sets[0].exercise" is missing',
      'Field "sets[1].weight" expected type "number", got "string"',
      'Field "sets[2]" expected an object, got "string"',
    ])
  })
})

describe('validateActivityData with the built-in strength_training schema', () => {
  it('accepts a set exactly as Gravl writes it', () => {
    const result = validateActivityData(
      {
        sets: [
          {
            distance: null,
            exercise: 'Bench Press',
            exercise_id: 12,
            order: 2,
            reps: 8,
            rpe: 8,
            set_type: 'normal',
            superset_id: 3,
            time: null,
            weight: 80,
          },
        ],
      },
      strengthTrainingDataSchema,
    )
    expect(result).toEqual({ valid: true })
  })

  it('accepts reps in reserve and a note', () => {
    const result = validateActivityData(
      { sets: [{ exercise: 'Squat', note: 'slow', reps: 5, rir: 2, weight: 100 }] },
      strengthTrainingDataSchema,
    )
    expect(result).toEqual({ valid: true })
  })

  it('rejects a set_type outside the declared values', () => {
    const result = validateActivityData(
      { sets: [{ exercise: 'Squat', set_type: 'amrap' }] },
      strengthTrainingDataSchema,
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([
      'Field "sets[0].set_type" value "amrap" is not one of: normal, warmup, drop_set, failure',
    ])
  })

  it('rejects an rpe that is not a number', () => {
    const result = validateActivityData(
      { sets: [{ exercise: 'Squat', rpe: '8' }] },
      strengthTrainingDataSchema,
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(['Field "sets[0].rpe" expected type "number", got "string"'])
  })
})

describe('validateActivityData with number bounds', () => {
  const boundedSchema: DataSchemaDefinition = {
    fields: [
      { max: 10, min: 0, name: 'severity', type: 'number' },
      { name: 'count', type: 'number' },
      { item_fields: [{ min: 1, name: 'reps', type: 'number' }], name: 'sets', type: 'list' },
    ],
  }

  it('accepts values in range and at both bounds', () => {
    expect(validateActivityData({ severity: 5 }, boundedSchema)).toEqual({ valid: true })
    expect(validateActivityData({ severity: 0 }, boundedSchema)).toEqual({ valid: true })
    expect(validateActivityData({ severity: 10 }, boundedSchema)).toEqual({ valid: true })
  })

  it('rejects a value above the maximum', () => {
    expect(validateActivityData({ severity: 11 }, boundedSchema)).toEqual({
      errors: ['Field "severity" value 11 is above the maximum 10'],
      valid: false,
    })
  })

  it('rejects a value below the minimum', () => {
    expect(validateActivityData({ severity: -1 }, boundedSchema)).toEqual({
      errors: ['Field "severity" value -1 is below the minimum 0'],
      valid: false,
    })
  })

  it('checks the bounds of a list item field', () => {
    expect(validateActivityData({ sets: [{ reps: 1 }, { reps: 0 }] }, boundedSchema)).toEqual({
      errors: ['Field "sets[1].reps" value 0 is below the minimum 1'],
      valid: false,
    })
  })

  it('leaves a field without bounds unchanged', () => {
    expect(validateActivityData({ count: -1000 }, boundedSchema)).toEqual({ valid: true })
    expect(validateActivityData({ count: 1e9 }, boundedSchema)).toEqual({ valid: true })
  })
})
