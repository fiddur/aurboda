import { describe, expect, test } from 'vitest'

import { terseDescription, terseInputSchema } from './tool-catalogue.ts'

const isoDateTime = {
  description: 'ISO 8601 date-time string',
  example: '2024-01-15T14:30:00Z',
  format: 'date-time',
  id: 'ISO8601DateTime',
  pattern: '^\\d{4}-\\d{2}-\\d{2}T.*Z$',
  type: 'string',
}

const withDefinitions = (properties: Record<string, unknown>, definitions: Record<string, unknown> = {}) => ({
  $schema: 'http://json-schema.org/draft-07/schema#',
  additionalProperties: false,
  definitions: { ISO8601DateTime: isoDateTime, ...definitions },
  properties,
  type: 'object',
})

describe('terseDescription', () => {
  test('keeps the first sentence of the first line', () => {
    expect(terseDescription('Create a rule. It runs nightly.\n\nCondition kinds:\n- "activity"')).toBe(
      'Create a rule.',
    )
  })

  test('does not end a sentence at e.g. or i.e.', () => {
    expect(terseDescription('Bucket size, e.g. 5m. Second sentence.')).toBe('Bucket size, e.g. 5m.')
    expect(terseDescription('The zone, i.e. the IANA name! More.')).toBe('The zone, i.e. the IANA name!')
  })

  test('keeps a whole line without a sentence end', () => {
    expect(terseDescription('No sentence end here\nsecond line')).toBe('No sentence end here')
  })

  test('does not end a sentence at a dot inside a token', () => {
    expect(terseDescription('Values like 1.5 or file.txt are fine? Yes.')).toBe(
      'Values like 1.5 or file.txt are fine?',
    )
  })

  test('cuts a long line at max', () => {
    const long = 'x'.repeat(300)
    expect(terseDescription(long)).toBe('x'.repeat(200))
    expect(terseDescription(long, 120)).toBe('x'.repeat(120))
  })

  test('passes undefined through', () => {
    expect(terseDescription(undefined)).toBeUndefined()
  })
})

describe('terseInputSchema', () => {
  test('resolves a $ref and drops the pattern but keeps the format', () => {
    const result = terseInputSchema(withDefinitions({ start: { $ref: '#/definitions/ISO8601DateTime' } }))
    expect(result.properties?.start).toEqual({
      description: 'ISO 8601 date-time string',
      format: 'date-time',
      type: 'string',
    })
  })

  test('unwraps a described single-element allOf around a $ref', () => {
    const result = terseInputSchema(
      withDefinitions({
        start: { allOf: [{ $ref: '#/definitions/ISO8601DateTime' }], description: 'Start' },
      }),
    )
    expect(result.properties?.start).toEqual({ description: 'Start', format: 'date-time', type: 'string' })
  })

  test('keeps the enum of a referenced enum definition and its description', () => {
    const result = terseInputSchema(
      withDefinitions(
        { entity_type: { $ref: '#/definitions/EntityType' } },
        {
          EntityType: {
            description: 'Entity type for polymorphic references. `note` marks a reply.',
            enum: ['activity', 'note', 'time'],
            example: 'activity',
            type: 'string',
          },
        },
      ),
    )
    expect(result.properties?.entity_type).toEqual({
      description: 'Entity type for polymorphic references.',
      enum: ['activity', 'note', 'time'],
      type: 'string',
    })
  })

  test('resolves refs through other refs', () => {
    const result = terseInputSchema(
      withDefinitions(
        { tz: { $ref: '#/definitions/Alias' } },
        { Alias: { $ref: '#/definitions/Timezone' }, Timezone: { type: 'string' } },
      ),
    )
    expect(result.properties?.tz).toEqual({ type: 'string' })
  })

  test('a nullable referenced object becomes object|null with no nested properties', () => {
    const result = terseInputSchema(
      withDefinitions(
        { location: { anyOf: [{ $ref: '#/definitions/Point' }, { type: 'null' }], description: 'Where' } },
        {
          Point: {
            properties: { lat: { type: 'number' }, lon: { type: 'number' } },
            required: ['lat', 'lon'],
            type: 'object',
          },
        },
      ),
    )
    expect(result.properties?.location).toEqual({ description: 'Where', type: 'object|null' })
    expect(JSON.stringify(result)).not.toContain('lat')
  })

  test('a nullable enum keeps its values', () => {
    const result = terseInputSchema(
      withDefinitions({ mode: { anyOf: [{ enum: ['a', 'b'], type: 'string' }, { type: 'null' }] } }),
    )
    expect(result.properties?.mode).toEqual({ enum: ['a', 'b'], type: 'string|null' })
  })

  test('an array of objects shows only the item type', () => {
    const result = terseInputSchema(
      withDefinitions({
        conditions: {
          description: 'Conditions',
          items: { properties: { kind: { type: 'string' } }, required: ['kind'], type: 'object' },
          maxItems: 10,
          minItems: 1,
          type: 'array',
        },
      }),
    )
    expect(result.properties?.conditions).toEqual({
      description: 'Conditions',
      items: { type: 'object' },
      type: 'array',
    })
  })

  test('an array of a oneOf of objects shows item type object', () => {
    const result = terseInputSchema(
      withDefinitions({
        conditions: {
          items: { oneOf: [{ type: 'object' }, { properties: {}, type: 'object' }] },
          type: 'array',
        },
      }),
    )
    expect(result.properties?.conditions).toEqual({ items: { type: 'object' }, type: 'array' })
  })

  test('derives the type of a const or an untyped enum', () => {
    const result = terseInputSchema(withDefinitions({ kind: { const: 'activity' }, n: { enum: [1, 2] } }))
    expect(result.properties?.kind).toEqual({ const: 'activity', type: 'string' })
    expect(result.properties?.n).toEqual({ enum: [1, 2], type: 'number' })
  })

  test('joins an array type and keeps required, dropping everything else', () => {
    const result = terseInputSchema({
      ...withDefinitions({
        limit: { default: 10, examples: [5], maximum: 100, minimum: 1, type: ['integer', 'null'] },
        name: { example: 'x', minLength: 1, type: 'string' },
      }),
      required: ['name'],
    })
    expect(result).toEqual({
      properties: { limit: { type: 'integer|null' }, name: { type: 'string' } },
      required: ['name'],
      type: 'object',
    })
  })

  test('a schema without properties becomes a bare object', () => {
    expect(terseInputSchema({ $schema: 'x', type: 'object' })).toEqual({ type: 'object' })
  })

  test('odd property shapes fall back to any', () => {
    const result = terseInputSchema(
      withDefinitions({
        empty: {},
        missing: { $ref: '#/definitions/Nope' },
        weird: 'not a schema',
        wide: { allOf: [{ type: 'string' }, { minLength: 1 }] },
      }),
    )
    expect(result.properties).toEqual({
      empty: { type: 'any' },
      missing: { type: 'any' },
      weird: { type: 'any' },
      wide: { type: 'any' },
    })
  })

  test('a self-referencing definition does not loop', () => {
    const result = terseInputSchema(
      withDefinitions({ node: { $ref: '#/definitions/Loop' } }, { Loop: { $ref: '#/definitions/Loop' } }),
    )
    expect(result.properties?.node).toEqual({ type: 'any' })
  })

  test('cuts a field description at the first sentence and 120 characters', () => {
    const result = terseInputSchema(
      withDefinitions({
        a: { description: 'First sentence. Second sentence.', type: 'string' },
        b: { description: 'y'.repeat(150), type: 'string' },
      }),
    )
    expect(result.properties?.a).toEqual({ description: 'First sentence.', type: 'string' })
    expect(result.properties?.b).toEqual({ description: 'y'.repeat(120), type: 'string' })
  })
})
