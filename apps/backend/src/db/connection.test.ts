import type { Client, QueryResult, QueryResultRow } from 'pg'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { _isSchemaError, _runMigrationOnce, _setClientForUser, query } from './connection'

describe('isSchemaError', () => {
  test('returns true for undefined_table (42P01)', () => {
    const error = Object.assign(new Error('relation "foo" does not exist'), { code: '42P01' })
    expect(_isSchemaError(error)).toBe(true)
  })

  test('returns true for undefined_column (42703)', () => {
    const error = Object.assign(new Error('column "bar" does not exist'), { code: '42703' })
    expect(_isSchemaError(error)).toBe(true)
  })

  test('returns false for syntax error', () => {
    const error = Object.assign(new Error('syntax error'), { code: '42601' })
    expect(_isSchemaError(error)).toBe(false)
  })

  test('returns false for unique violation', () => {
    const error = Object.assign(new Error('duplicate key'), { code: '23505' })
    expect(_isSchemaError(error)).toBe(false)
  })

  test('returns false for error without code', () => {
    expect(_isSchemaError(new Error('some error'))).toBe(false)
  })

  test('returns false for non-Error values', () => {
    expect(_isSchemaError('string error')).toBe(false)
    expect(_isSchemaError(null)).toBe(false)
    expect(_isSchemaError(undefined)).toBe(false)
  })
})

describe('runMigrationOnce', () => {
  const mockMigrate = vi.fn<(user: string) => Promise<void>>()

  beforeEach(() => {
    mockMigrate.mockReset()
  })

  test('calls migrateSchema for the user', async () => {
    mockMigrate.mockResolvedValue(undefined)
    await _runMigrationOnce('testuser', mockMigrate)
    expect(mockMigrate).toHaveBeenCalledWith('testuser')
    expect(mockMigrate).toHaveBeenCalledTimes(1)
  })

  test('coalesces concurrent calls for same user', async () => {
    let resolveFirst!: () => void
    mockMigrate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve
        }),
    )

    const promise1 = _runMigrationOnce('user1', mockMigrate)
    const promise2 = _runMigrationOnce('user1', mockMigrate)

    // Both should return the same promise
    expect(promise1).toBe(promise2)

    resolveFirst()
    await promise1
    await promise2

    // Only called once despite two requests
    expect(mockMigrate).toHaveBeenCalledTimes(1)
  })

  test('does not coalesce calls for different users', async () => {
    mockMigrate.mockResolvedValue(undefined)

    const promise1 = _runMigrationOnce('user1', mockMigrate)
    const promise2 = _runMigrationOnce('user2', mockMigrate)

    expect(promise1).not.toBe(promise2)

    await promise1
    await promise2

    expect(mockMigrate).toHaveBeenCalledTimes(2)
  })

  test('releases lock on failure, allowing subsequent calls', async () => {
    mockMigrate.mockRejectedValueOnce(new Error('migration failed'))

    await expect(_runMigrationOnce('failuser', mockMigrate)).rejects.toThrow('migration failed')

    // After failure, a new call should trigger a new migration attempt
    mockMigrate.mockResolvedValue(undefined)
    await _runMigrationOnce('failuser', mockMigrate)
    expect(mockMigrate).toHaveBeenCalledTimes(2)
  })
})

const mockQueryResult = <T extends QueryResultRow>(rows: T[] = []): QueryResult<T> => ({
  command: 'SELECT',
  fields: [],
  oid: 0,
  rowCount: rows.length,
  rows,
})

describe('query retry on schema error', () => {
  const makeClient = (queryFn: (...args: unknown[]) => Promise<QueryResult>) =>
    ({ query: queryFn }) as unknown as Client

  test('retries on schema error when called with username', async () => {
    const mockMigrate = vi.fn<(user: string) => Promise<void>>().mockResolvedValue(undefined)
    let callCount = 0
    const client = makeClient(async () => {
      callCount++
      if (callCount === 1) {
        throw Object.assign(new Error('relation "metrics" does not exist'), { code: '42P01' })
      }
      return mockQueryResult([{ id: 1 }])
    })

    _setClientForUser('retryuser', client)
    const result = await query('retryuser', 'SELECT * FROM metrics', undefined, mockMigrate)

    expect(result.rows).toEqual([{ id: 1 }])
    expect(mockMigrate).toHaveBeenCalledWith('retryuser')
    expect(callCount).toBe(2)
  })

  test('does NOT retry when called with Client directly', async () => {
    const mockMigrate = vi.fn<(user: string) => Promise<void>>()
    const client = makeClient(async () => {
      throw Object.assign(new Error('relation "metrics" does not exist'), { code: '42P01' })
    })

    await expect(query(client, 'SELECT * FROM metrics', undefined, mockMigrate)).rejects.toThrow(
      'relation "metrics" does not exist',
    )
    expect(mockMigrate).not.toHaveBeenCalled()
  })

  test('does NOT retry on non-schema errors', async () => {
    const mockMigrate = vi.fn<(user: string) => Promise<void>>()
    const client = makeClient(async () => {
      throw Object.assign(new Error('syntax error'), { code: '42601' })
    })

    _setClientForUser('syntaxuser', client)
    await expect(query('syntaxuser', 'SELECT * FROM foo', undefined, mockMigrate)).rejects.toThrow(
      'syntax error',
    )
    expect(mockMigrate).not.toHaveBeenCalled()
  })

  test('propagates error if retry also fails', async () => {
    const mockMigrate = vi.fn<(user: string) => Promise<void>>().mockResolvedValue(undefined)
    const client = makeClient(async () => {
      throw Object.assign(new Error('relation "metrics" does not exist'), { code: '42P01' })
    })

    _setClientForUser('doublefail', client)
    await expect(query('doublefail', 'SELECT * FROM metrics', undefined, mockMigrate)).rejects.toThrow(
      'relation "metrics" does not exist',
    )
    expect(mockMigrate).toHaveBeenCalledTimes(1)
  })
})
