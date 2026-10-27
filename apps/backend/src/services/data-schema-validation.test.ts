import type { DataSchemaDefinition } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

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
