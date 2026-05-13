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
