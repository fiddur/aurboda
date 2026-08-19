import { describe, expect, test } from 'vitest'

import { createTableStatements, tableCreationOrder } from './schema.ts'

/**
 * The schema runner executes ONLY the keys listed in `tableCreationOrder` —
 * a statement present in `createTableStatements` but missing from the order
 * list silently never runs. For an additive column migration that is
 * invisible locally (fresh DBs get the column from the CREATE TABLE) and
 * breaks only in production on existing databases, as `feed_posts.message`
 * did (#1000 → 500 on share). These two sets must therefore stay identical.
 */
describe('schema statement wiring', () => {
  test('every createTableStatements key is listed in tableCreationOrder', () => {
    const ordered = new Set(tableCreationOrder)
    const missing = Object.keys(createTableStatements).filter((key) => !ordered.has(key))
    expect(missing).toEqual([])
  })

  test('tableCreationOrder lists no unknown or duplicate keys', () => {
    const unknown = tableCreationOrder.filter((key) => !(key in createTableStatements))
    expect(unknown).toEqual([])
    expect(new Set(tableCreationOrder).size).toBe(tableCreationOrder.length)
  })
})
