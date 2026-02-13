import { describe, expect, test } from 'vitest'
import { buildDynamicUpdate } from './dynamic-update'

describe('buildDynamicUpdate', () => {
  test('builds a simple update with one field', () => {
    const result = buildDynamicUpdate('activities', 'abc-123', [{ column: 'title', value: 'New title' }], {
      returning: 'id, title',
    })

    expect(result).not.toBeNull()
    expect(result!.sql).toBe('UPDATE activities SET title = $1 WHERE id = $2 RETURNING id, title')
    expect(result!.params).toEqual(['New title', 'abc-123'])
  })

  test('builds an update with multiple fields', () => {
    const result = buildDynamicUpdate(
      'activities',
      'abc-123',
      [
        { column: 'title', value: 'New title' },
        { column: 'notes', value: 'Some notes' },
        { column: 'start_time', value: new Date('2024-01-15T10:00:00Z') },
      ],
      { returning: 'id' },
    )

    expect(result).not.toBeNull()
    expect(result!.sql).toBe(
      'UPDATE activities SET title = $1, notes = $2, start_time = $3 WHERE id = $4 RETURNING id',
    )
    expect(result!.params).toEqual(['New title', 'Some notes', new Date('2024-01-15T10:00:00Z'), 'abc-123'])
  })

  test('returns null when no fields provided', () => {
    const result = buildDynamicUpdate('activities', 'abc-123', [], { returning: 'id' })
    expect(result).toBeNull()
  })

  test('includes default clauses', () => {
    const result = buildDynamicUpdate('named_locations', 'loc-1', [{ column: 'name', value: 'Office' }], {
      defaultClauses: ['updated_at = NOW()'],
      returning: 'id, name',
    })

    expect(result).not.toBeNull()
    expect(result!.sql).toBe(
      'UPDATE named_locations SET updated_at = NOW(), name = $1 WHERE id = $2 RETURNING id, name',
    )
    expect(result!.params).toEqual(['Office', 'loc-1'])
  })

  test('returns non-null with only default clauses and no fields', () => {
    const result = buildDynamicUpdate('named_locations', 'loc-1', [], {
      defaultClauses: ['updated_at = NOW()'],
      returning: 'id',
    })

    expect(result).not.toBeNull()
    expect(result!.sql).toBe('UPDATE named_locations SET updated_at = NOW() WHERE id = $1 RETURNING id')
    expect(result!.params).toEqual(['loc-1'])
  })

  test('handles multi-value expressions', () => {
    const result = buildDynamicUpdate(
      'named_locations',
      'loc-1',
      [{ expression: 'location = ST_MakePoint($NEXT, $NEXT)::geography', values: [18.0686, 59.3293] }],
      {
        defaultClauses: ['updated_at = NOW()'],
        returning: 'id',
      },
    )

    expect(result).not.toBeNull()
    expect(result!.sql).toBe(
      'UPDATE named_locations SET updated_at = NOW(), location = ST_MakePoint($1, $2)::geography WHERE id = $3 RETURNING id',
    )
    expect(result!.params).toEqual([18.0686, 59.3293, 'loc-1'])
  })

  test('mixes simple fields and expressions', () => {
    const result = buildDynamicUpdate(
      'detected_locations',
      'det-1',
      [
        { expression: 'location = ST_MakePoint($NEXT, $NEXT)::geography', values: [18.0686, 59.3293] },
        { column: 'radius', value: 300 },
        { column: 'address', value: '123 Main St' },
      ],
      {
        defaultClauses: ['updated_at = NOW()'],
        returning: 'id',
      },
    )

    expect(result).not.toBeNull()
    expect(result!.sql).toBe(
      'UPDATE detected_locations SET updated_at = NOW(), location = ST_MakePoint($1, $2)::geography, radius = $3, address = $4 WHERE id = $5 RETURNING id',
    )
    expect(result!.params).toEqual([18.0686, 59.3293, 300, '123 Main St', 'det-1'])
  })
})
