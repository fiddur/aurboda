import { describe, expect, test } from 'vitest'

import { _hashSchema, createTableStatements, schemaFingerprint, tableCreationOrder } from './schema.ts'

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

/**
 * `migrateSchema` skips its ~130 statements when the database already records
 * this build's fingerprint, so the fingerprint has to actually change whenever
 * a migration's content does (#1125).
 */
describe('schemaFingerprint', () => {
  test('is a stable 16-char hex digest', () => {
    expect(schemaFingerprint()).toMatch(/^[0-9a-f]{16}$/)
    expect(schemaFingerprint()).toBe(schemaFingerprint())
  })

  test('changes when MIGRATION_REVISION changes', () => {
    // The revision is what covers the imperative backfills inside
    // migrateSchema — the part no DDL hash can see.
    const statements: [string, string][] = [['activities', 'CREATE TABLE activities ()']]

    expect(_hashSchema(1, statements)).not.toBe(_hashSchema(2, statements))
  })

  test('changes when a DDL statement changes, so a schema edit cannot be forgotten', () => {
    expect(_hashSchema(1, [['t', 'CREATE TABLE t (a INT)']])).not.toBe(
      _hashSchema(1, [['t', 'CREATE TABLE t (a INT, b INT)']]),
    )
  })

  test('changes when statements are reordered — order is part of the schema', () => {
    const a: [string, string] = ['a', 'CREATE TABLE a ()']
    const b: [string, string] = ['b', 'CREATE TABLE b ()']

    expect(_hashSchema(1, [a, b])).not.toBe(_hashSchema(1, [b, a]))
  })
})
