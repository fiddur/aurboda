import { beforeEach, describe, expect, test, vi } from 'vitest'

// Create mock query function that will be used by the mocked module
const mockQueryFn = vi.fn()

// Mock pg Client
vi.mock('pg', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    query: mockQueryFn,
  })),
}))

// Mock pg-format
vi.mock('pg-format', () => ({
  default: vi.fn((str) => str),
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
