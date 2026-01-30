/**
 * Database unit tests (mock-based).
 *
 * These tests use mocks to verify:
 * - Business logic and validation (e.g., metric validation, deduplication)
 * - Connection management behavior
 * - Module isolation
 *
 * For SQL correctness, see db.integration.test.ts which runs against real PostgreSQL.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

// Create mock query function that will be used by the mocked module
const mockQueryFn = vi.fn()

// Mock connect function
const mockConnectFn = vi.fn()

// Track Client constructor calls
const mockClientConstructor = vi.fn().mockImplementation(() => ({
  connect: mockConnectFn,
  query: mockQueryFn,
}))

// Mock pg Client
vi.mock('pg', () => ({
  Client: mockClientConstructor,
}))

// Mock pg-format - capture the mock for later access
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFormat = vi.fn((...args: any[]) => args[0] as string)
vi.mock('pg-format', () => ({
  default: mockFormat,
}))

describe('Daily Aggregates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockQueryFn.mockResolvedValue({ rowCount: 0, rows: [] })
  })

  describe('processDailyAggregate', () => {
    test('stores valid steps aggregate with correct parameters', async () => {
      // Import fresh module after mocks are set up
      const { processDailyAggregate } = await import('./db.js')

      // Directly test the SQL that would be generated
      await processDailyAggregate('testuser', {
        dataOrigins: ['com.oura.ring', 'com.polar.beat'],
        date: '2024-01-15',
        metric: 'steps',
        value: 10000,
      })

      // The function should have called query multiple times (SET ROLE + INSERT)
      expect(mockQueryFn).toHaveBeenCalled()

      // Find the INSERT call (skip SET ROLE calls)
      const insertCall = mockQueryFn.mock.calls.find((call) => call[0].includes('INSERT INTO time_series'))
      expect(insertCall).toBeDefined()
      expect(insertCall![0]).toContain('health_connect_aggregate')
      expect(insertCall![0]).toContain('ON CONFLICT')
    })

    test('rejects invalid metric with warning', async () => {
      const { processDailyAggregate } = await import('./db.js')
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await processDailyAggregate('testuser', {
        dataOrigins: [],
        date: '2024-01-15',
        metric: 'invalid_metric',
        value: 100,
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid metric in daily aggregate: invalid_metric'),
      )
      consoleSpy.mockRestore()
    })

    test('rejects non-cumulative metric with warning', async () => {
      const { processDailyAggregate } = await import('./db.js')
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await processDailyAggregate('testuser', {
        dataOrigins: [],
        date: '2024-01-15',
        metric: 'heart_rate', // Valid metric but not cumulative
        value: 72,
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('heart_rate is not a cumulative metric'),
      )
      consoleSpy.mockRestore()
    })

    test('accepts all cumulative metrics', async () => {
      const { processDailyAggregate } = await import('./db.js')
      const cumulativeMetrics = ['steps', 'distance', 'floors_climbed', 'calories_active', 'calories_total']

      for (const metric of cumulativeMetrics) {
        mockQueryFn.mockClear()
        await processDailyAggregate('testuser', {
          dataOrigins: [],
          date: '2024-01-15',
          metric,
          value: 100,
        })
        expect(mockQueryFn).toHaveBeenCalled()
      }
    })
  })

  describe('getDailyAggregateValue', () => {
    test('returns value when aggregate exists', async () => {
      mockQueryFn.mockResolvedValue({
        rowCount: 1,
        rows: [{ value: 12500 }],
      })

      const { getDailyAggregateValue } = await import('./db.js')
      const result = await getDailyAggregateValue('testuser', 'steps', new Date('2024-01-15'))

      expect(result).toBe(12500)
    })

    test('returns null when no aggregate exists', async () => {
      mockQueryFn.mockResolvedValue({
        rowCount: 0,
        rows: [],
      })

      const { getDailyAggregateValue } = await import('./db.js')
      const result = await getDailyAggregateValue('testuser', 'steps', new Date('2024-01-15'))

      expect(result).toBeNull()
    })

    test('queries with health_connect_aggregate source', async () => {
      mockQueryFn.mockResolvedValue({ rowCount: 0, rows: [] })

      const { getDailyAggregateValue } = await import('./db.js')
      await getDailyAggregateValue('testuser', 'distance', new Date('2024-06-20'))

      expect(mockQueryFn).toHaveBeenCalled()
      // Find the SELECT call (skip SET ROLE calls)
      const selectCall = mockQueryFn.mock.calls.find((call) => call[0].includes('SELECT'))
      expect(selectCall).toBeDefined()
      expect(selectCall![0]).toContain("source = 'health_connect_aggregate'")
    })
  })
})

describe('getSleepSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockQueryFn.mockResolvedValue({ rowCount: 0, rows: [] })
  })

  test('returns overnight sleep session on wake-up day', async () => {
    // Sleep starting at 23:00 on Jan 14, ending at 07:00 on Jan 15
    // Should appear in Jan 15's summary (wake-up day)
    mockQueryFn.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          activity_type: 'sleep',
          data: { score: 85 },
          end_time: new Date('2024-01-15T07:00:00Z'),
          id: 'sleep-1',
          notes: null,
          source: 'oura',
          start_time: new Date('2024-01-14T23:00:00Z'),
          title: null,
        },
      ],
    })

    const { getSleepSessions } = await import('./db.js')

    // Query for Jan 15's sleep
    const start = new Date('2024-01-15T00:00:00Z')
    const end = new Date('2024-01-15T23:59:59Z')
    const result = await getSleepSessions('testuser', start, end)

    expect(result).toHaveLength(1)
    expect(result[0].startTime).toEqual(new Date('2024-01-14T23:00:00Z'))
    expect(result[0].endTime).toEqual(new Date('2024-01-15T07:00:00Z'))
  })

  test('returns sleep session that starts and ends on same day', async () => {
    // A nap that starts at 14:00 and ends at 15:30 on Jan 15
    mockQueryFn.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          activity_type: 'sleep',
          data: null,
          end_time: new Date('2024-01-15T15:30:00Z'),
          id: 'sleep-2',
          notes: null,
          source: 'health_connect',
          start_time: new Date('2024-01-15T14:00:00Z'),
          title: null,
        },
      ],
    })

    const { getSleepSessions } = await import('./db.js')
    const result = await getSleepSessions(
      'testuser',
      new Date('2024-01-15T00:00:00Z'),
      new Date('2024-01-15T23:59:59Z'),
    )

    expect(result).toHaveLength(1)
    expect(result[0].startTime).toEqual(new Date('2024-01-15T14:00:00Z'))
  })

  test('returns ongoing sleep session with no end_time', async () => {
    // Sleep that started at 23:00 but hasn't ended yet (no end_time)
    mockQueryFn.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          activity_type: 'sleep',
          data: null,
          end_time: null,
          id: 'sleep-3',
          notes: null,
          source: 'oura',
          start_time: new Date('2024-01-14T23:00:00Z'),
          title: null,
        },
      ],
    })

    const { getSleepSessions } = await import('./db.js')
    const result = await getSleepSessions(
      'testuser',
      new Date('2024-01-15T00:00:00Z'),
      new Date('2024-01-15T23:59:59Z'),
    )

    expect(result).toHaveLength(1)
    expect(result[0].endTime).toBeUndefined()
  })

  test('uses date overlap query for sleep sessions', async () => {
    mockQueryFn.mockResolvedValue({ rowCount: 0, rows: [] })

    const { getSleepSessions } = await import('./db.js')
    await getSleepSessions('testuser', new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))

    // Find the SELECT call (skip SET ROLE calls)
    const selectCall = mockQueryFn.mock.calls.find((call) => call[0].includes('SELECT'))
    expect(selectCall).toBeDefined()
    // Should use overlap logic: start_time < day_end AND (end_time >= day_start OR end_time IS NULL)
    expect(selectCall![0]).toContain('start_time <')
    expect(selectCall![0]).toContain('end_time >=')
    expect(selectCall![0]).toContain('end_time IS NULL')
  })

  test('returns empty array when no sleep sessions', async () => {
    mockQueryFn.mockResolvedValue({ rowCount: 0, rows: [] })

    const { getSleepSessions } = await import('./db.js')
    const result = await getSleepSessions(
      'testuser',
      new Date('2024-01-15T00:00:00Z'),
      new Date('2024-01-15T23:59:59Z'),
    )

    expect(result).toEqual([])
  })
})

describe('makeNewUserDb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockQueryFn.mockResolvedValue({ rowCount: 0, rows: [] })
    mockConnectFn.mockResolvedValue(undefined)
  })

  test('creates PostgreSQL user with encrypted password', async () => {
    const { makeNewUserDb } = await import('./db.js')
    const mockUserDb = { connect: vi.fn(), query: mockQueryFn } as unknown as import('pg').Client

    await makeNewUserDb(mockUserDb, 'newuser', 'securepassword')

    // Find the CREATE USER call
    const createUserCall = mockQueryFn.mock.calls.find((call) => call[0].includes('CREATE USER'))
    expect(createUserCall).toBeDefined()
    expect(createUserCall![0]).toContain('CREATE USER')
    expect(createUserCall![0]).toContain('ENCRYPTED PASSWORD')
  })

  test('grants role to service user', async () => {
    const { makeNewUserDb } = await import('./db.js')
    const mockUserDb = { connect: vi.fn(), query: mockQueryFn } as unknown as import('pg').Client

    await makeNewUserDb(mockUserDb, 'newuser', 'securepassword')

    // Find the GRANT call
    const grantCall = mockQueryFn.mock.calls.find((call) => call[0].includes('GRANT'))
    expect(grantCall).toBeDefined()
    expect(grantCall![0]).toContain('GRANT')
  })

  test('creates database with correct naming convention', async () => {
    const { makeNewUserDb } = await import('./db.js')
    const mockUserDb = { connect: vi.fn(), query: mockQueryFn } as unknown as import('pg').Client

    await makeNewUserDb(mockUserDb, 'testuser', 'password')

    // Find the CREATE DATABASE call
    const createDbCall = mockQueryFn.mock.calls.find((call) => call[0].includes('CREATE DATABASE'))
    expect(createDbCall).toBeDefined()
    expect(createDbCall![0]).toContain('CREATE DATABASE')
    expect(createDbCall![0]).toContain('OWNER')
  })

  test('connects to newly created database', async () => {
    const { makeNewUserDb } = await import('./db.js')
    const mockUserDb = { connect: vi.fn(), query: mockQueryFn } as unknown as import('pg').Client

    await makeNewUserDb(mockUserDb, 'newuser', 'password')

    // Should have created a client connection
    expect(mockClientConstructor).toHaveBeenCalledWith({
      database: 'aurboda_newuser',
      password: 'password',
      user: 'newuser',
    })
    expect(mockConnectFn).toHaveBeenCalled()
  })
})

describe('loginToUserDb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockQueryFn.mockResolvedValue({ rowCount: 0, rows: [] })
    mockConnectFn.mockResolvedValue(undefined)
  })

  test('creates new connection on first login', async () => {
    const { loginToUserDb } = await import('./db.js')

    await loginToUserDb('newuser', 'password123')

    expect(mockClientConstructor).toHaveBeenCalledWith({
      database: 'aurboda_newuser',
      password: 'password123',
      user: 'newuser',
    })
    expect(mockConnectFn).toHaveBeenCalledTimes(1)
  })

  test('reuses existing connection with same password', async () => {
    const { loginToUserDb } = await import('./db.js')

    // First login
    await loginToUserDb('existinguser', 'password123')
    expect(mockClientConstructor).toHaveBeenCalledTimes(1)
    expect(mockConnectFn).toHaveBeenCalledTimes(1)

    // Clear mocks to track subsequent calls
    mockClientConstructor.mockClear()
    mockConnectFn.mockClear()

    // Second login with same password should NOT create a new connection
    await loginToUserDb('existinguser', 'password123')
    expect(mockClientConstructor).not.toHaveBeenCalled()
    expect(mockConnectFn).not.toHaveBeenCalled()
  })

  test('reuses connection on subsequent login regardless of password', async () => {
    const { loginToUserDb } = await import('./db.js')

    // First login with correct password
    await loginToUserDb('existinguser', 'password123')
    expect(mockClientConstructor).toHaveBeenCalledTimes(1)

    // Clear mocks to track subsequent calls
    mockClientConstructor.mockClear()
    mockConnectFn.mockClear()

    // Second login with different password should still work (auth is token-based)
    // Password is only validated on initial connection to PostgreSQL
    await loginToUserDb('existinguser', 'differentpassword')
    expect(mockClientConstructor).not.toHaveBeenCalled()
    expect(mockConnectFn).not.toHaveBeenCalled()
  })

  test('creates separate connections for different users', async () => {
    const { loginToUserDb } = await import('./db.js')

    await loginToUserDb('user1', 'password1')
    await loginToUserDb('user2', 'password2')

    expect(mockClientConstructor).toHaveBeenCalledTimes(2)
    expect(mockClientConstructor).toHaveBeenCalledWith({
      database: 'aurboda_user1',
      password: 'password1',
      user: 'user1',
    })
    expect(mockClientConstructor).toHaveBeenCalledWith({
      database: 'aurboda_user2',
      password: 'password2',
      user: 'user2',
    })
  })
})

describe('insertTimeSeries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockQueryFn.mockResolvedValue({ rowCount: 0, rows: [] })
    mockFormat.mockClear()
  })

  // Helper to get the values array from the last format call
  const getLastFormatValues = (): unknown[][] | undefined => {
    const calls = mockFormat.mock.calls
    // Find the call that has a values array (the INSERT call)
    for (let i = calls.length - 1; i >= 0; i--) {
      if (Array.isArray(calls[i][1])) {
        return calls[i][1] as unknown[][]
      }
    }
    return undefined
  }

  test('does nothing when points array is empty', async () => {
    const { insertTimeSeries } = await import('./db.js')

    await insertTimeSeries('testuser', [])

    // Should not have any INSERT calls
    const insertCall = mockQueryFn.mock.calls.find((call) => call[0]?.includes?.('INSERT'))
    expect(insertCall).toBeUndefined()
  })

  test('makes INSERT call with ON CONFLICT for non-empty points', async () => {
    const { insertTimeSeries } = await import('./db.js')

    const points = [
      {
        metric: 'heart_rate' as const,
        source: 'health_connect' as const,
        time: new Date('2024-01-15T10:00:00Z'),
        value: 72,
      },
    ]

    await insertTimeSeries('testuser', points)

    const insertCall = mockQueryFn.mock.calls.find((call) => call[0]?.includes?.('INSERT INTO time_series'))
    expect(insertCall).toBeDefined()
    expect(insertCall![0]).toContain('ON CONFLICT')
  })

  test('deduplicates points with same time, metric, and source - keeps last value', async () => {
    const { insertTimeSeries } = await import('./db.js')

    const duplicateTime = new Date('2024-01-15T10:00:00Z')
    const points = [
      { metric: 'heart_rate' as const, source: 'health_connect' as const, time: duplicateTime, value: 72 },
      { metric: 'heart_rate' as const, source: 'health_connect' as const, time: duplicateTime, value: 75 },
      { metric: 'heart_rate' as const, source: 'health_connect' as const, time: duplicateTime, value: 78 },
    ]

    await insertTimeSeries('testuser', points)

    const values = getLastFormatValues()
    // Should only have one row after deduplication
    expect(values).toBeDefined()
    expect(values).toHaveLength(1)
    // Last value (78) should win
    expect(values![0][2]).toBe(78)
  })

  test('preserves points with different timestamps', async () => {
    const { insertTimeSeries } = await import('./db.js')

    const points = [
      {
        metric: 'heart_rate' as const,
        source: 'health_connect' as const,
        time: new Date('2024-01-15T10:00:00Z'),
        value: 72,
      },
      {
        metric: 'heart_rate' as const,
        source: 'health_connect' as const,
        time: new Date('2024-01-15T10:00:01Z'),
        value: 75,
      },
      {
        metric: 'heart_rate' as const,
        source: 'health_connect' as const,
        time: new Date('2024-01-15T10:00:02Z'),
        value: 78,
      },
    ]

    await insertTimeSeries('testuser', points)

    const values = getLastFormatValues()
    // Should have all three rows (different timestamps)
    expect(values).toBeDefined()
    expect(values).toHaveLength(3)
  })

  test('deduplicates only matching time+metric+source combinations', async () => {
    const { insertTimeSeries } = await import('./db.js')

    const sameTime = new Date('2024-01-15T10:00:00Z')
    const points = [
      // Two with same time but different metrics - both should be kept
      { metric: 'heart_rate' as const, source: 'health_connect' as const, time: sameTime, value: 72 },
      { metric: 'resting_heart_rate' as const, source: 'health_connect' as const, time: sameTime, value: 65 },
      // Duplicate of first - should replace it
      { metric: 'heart_rate' as const, source: 'health_connect' as const, time: sameTime, value: 80 },
    ]

    await insertTimeSeries('testuser', points)

    const values = getLastFormatValues()
    // Should have two rows (heart_rate deduplicated, resting_heart_rate kept)
    expect(values).toBeDefined()
    expect(values).toHaveLength(2)
    // Find the heart_rate entry - should have last value (80)
    const hrEntry = values!.find((row) => row[1] === 'heart_rate')
    expect(hrEntry![2]).toBe(80)
    // Find the resting_heart_rate entry - should have value 65
    const restingHrEntry = values!.find((row) => row[1] === 'resting_heart_rate')
    expect(restingHrEntry![2]).toBe(65)
  })
})
