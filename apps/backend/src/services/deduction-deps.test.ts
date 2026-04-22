import { describe, expect, test, vi } from 'vitest'

vi.mock('../db/index', () => ({
  deleteStaleRuleActivities: vi.fn(),
  insertActivity: vi.fn().mockResolvedValue('new-id'),
  insertDeductionRuleRun: vi.fn(),
}))

vi.mock('../db/connection', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
}))

vi.mock('./locations', () => ({
  getPlaceVisits: vi.fn().mockResolvedValue([]),
}))

import { query } from '../db/connection.ts'
import { createDefaultEngineDeps } from './deduction-deps.ts'

const mockedQuery = vi.mocked(query)

describe('createDefaultEngineDeps', () => {
  test('insertActivity calls notifier with activity data', async () => {
    const notifier = vi.fn()
    const deps = createDefaultEngineDeps(notifier)

    const activity = {
      activity_type: 'tv',
      data: { rule_id: 'rule-123', rule_name: 'TV Rule' },
      end_time: new Date('2024-03-15T22:00:00Z'),
      id: 'act-1',
      source: 'deduction-rule' as const,
      start_time: new Date('2024-03-15T20:00:00Z'),
    }

    await deps.insertActivity('testuser', activity)

    expect(notifier).toHaveBeenCalledWith(
      'testuser',
      'tv',
      new Date('2024-03-15T20:00:00Z'),
      new Date('2024-03-15T22:00:00Z'),
      'rule-123',
    )
  })

  test('insertActivity works without notifier', async () => {
    const deps = createDefaultEngineDeps()
    const activity = {
      activity_type: 'tv',
      end_time: new Date('2024-03-15T22:00:00Z'),
      id: 'act-1',
      source: 'deduction-rule' as const,
      start_time: new Date('2024-03-15T20:00:00Z'),
    }

    const id = await deps.insertActivity('testuser', activity)
    expect(id).toBe('new-id')
  })

  test('insertActivity passes undefined sourceRuleId when no rule_id in data', async () => {
    const notifier = vi.fn()
    const deps = createDefaultEngineDeps(notifier)

    const activity = {
      activity_type: 'tv',
      end_time: new Date('2024-03-15T22:00:00Z'),
      id: 'act-1',
      source: 'deduction-rule' as const,
      start_time: new Date('2024-03-15T20:00:00Z'),
    }

    await deps.insertActivity('testuser', activity)

    expect(notifier).toHaveBeenCalledWith(
      'testuser',
      'tv',
      new Date('2024-03-15T20:00:00Z'),
      new Date('2024-03-15T22:00:00Z'),
      undefined,
    )
  })

  describe('getScrobbles', () => {
    const window = { start: new Date('2024-01-15T00:00:00Z'), end: new Date('2024-01-15T23:00:00Z') }

    test('returns time ranges with duration applied to each scrobble', async () => {
      const deps = createDefaultEngineDeps()
      mockedQuery.mockResolvedValueOnce({
        rows: [
          { recorded_at: new Date('2024-01-15T09:00:00Z') },
          { recorded_at: new Date('2024-01-15T09:05:00Z') },
        ],
      } as never)

      const result = await deps.getScrobbles('user', ['Artist'], undefined, 'exact', 210, window)

      expect(result).toEqual([
        { start: new Date('2024-01-15T09:00:00Z'), end: new Date('2024-01-15T09:03:30Z') },
        { start: new Date('2024-01-15T09:05:00Z'), end: new Date('2024-01-15T09:08:30Z') },
      ])
    })

    test('builds exact artist match query', async () => {
      const deps = createDefaultEngineDeps()
      mockedQuery.mockClear()
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never)

      await deps.getScrobbles('user', ['Holosync', 'Enya'], undefined, 'exact', 210, window)

      const lastCall = mockedQuery.mock.calls[mockedQuery.mock.calls.length - 1]
      const sql = lastCall[1] as string
      expect(sql).toContain(`LOWER(data->>'artist') = ANY($3)`)
      expect(lastCall[2]).toEqual([window.start, window.end, ['holosync', 'enya']])
    })

    test('builds contains artist match query with LIKE escaping', async () => {
      const deps = createDefaultEngineDeps()
      mockedQuery.mockClear()
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never)

      await deps.getScrobbles('user', ['100%'], undefined, 'contains', 210, window)

      const lastCall = mockedQuery.mock.calls[mockedQuery.mock.calls.length - 1]
      const params = lastCall[2] as unknown[]
      expect(params[2]).toBe('%100\\%%')
    })

    test('builds track match query', async () => {
      const deps = createDefaultEngineDeps()
      mockedQuery.mockClear()
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never)

      await deps.getScrobbles('user', undefined, 'Warmup', 'exact', 210, window)

      const lastCall = mockedQuery.mock.calls[mockedQuery.mock.calls.length - 1]
      const sql = lastCall[1] as string
      expect(sql).toContain(`LOWER(data->>'track') = $3`)
      expect(lastCall[2]).toEqual([window.start, window.end, 'warmup'])
    })

    test('returns empty array when no scrobbles match', async () => {
      const deps = createDefaultEngineDeps()
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never)

      const result = await deps.getScrobbles('user', ['Nobody'], undefined, 'exact', 210, window)
      expect(result).toEqual([])
    })

    test('builds contains track match query with LIKE escaping', async () => {
      const deps = createDefaultEngineDeps()
      mockedQuery.mockClear()
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never)

      await deps.getScrobbles('user', undefined, 'Track_1', 'contains', 210, window)

      const lastCall = mockedQuery.mock.calls[mockedQuery.mock.calls.length - 1]
      const params = lastCall[2] as unknown[]
      expect(params[2]).toBe('%track\\_1%')
    })

    test('builds combined artist and track query', async () => {
      const deps = createDefaultEngineDeps()
      mockedQuery.mockClear()
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never)

      await deps.getScrobbles('user', ['Artist'], 'Track', 'exact', 210, window)

      const lastCall = mockedQuery.mock.calls[mockedQuery.mock.calls.length - 1]
      const sql = lastCall[1] as string
      expect(sql).toContain(`LOWER(data->>'artist') = ANY($3)`)
      expect(sql).toContain(`LOWER(data->>'track') = $4`)
    })

    test('skips artist filter when artist array is empty', async () => {
      const deps = createDefaultEngineDeps()
      mockedQuery.mockClear()
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never)

      await deps.getScrobbles('user', [], 'Track', 'exact', 210, window)

      const lastCall = mockedQuery.mock.calls[mockedQuery.mock.calls.length - 1]
      const sql = lastCall[1] as string
      expect(sql).not.toContain('artist')
      expect(sql).toContain(`LOWER(data->>'track') = $3`)
    })

    test('contains mode with multiple artists uses OR', async () => {
      const deps = createDefaultEngineDeps()
      mockedQuery.mockClear()
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never)

      await deps.getScrobbles('user', ['A', 'B'], undefined, 'contains', 210, window)

      const lastCall = mockedQuery.mock.calls[mockedQuery.mock.calls.length - 1]
      const sql = lastCall[1] as string
      expect(sql).toContain('LIKE $3')
      expect(sql).toContain('LIKE $4')
      expect(sql).toContain(' OR ')
    })
  })

  describe('getScreentime', () => {
    const window = {
      end: new Date('2024-03-15T23:59:59Z'),
      start: new Date('2024-03-15T00:00:00Z'),
    }

    test('queries the activities table for screentime activities', async () => {
      const deps = createDefaultEngineDeps()
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never)

      await deps.getScreentime('user', ['Work', 'Programming'], window)

      const lastCall = mockedQuery.mock.calls[mockedQuery.mock.calls.length - 1]
      const sql = lastCall[1] as string
      expect(sql).toContain('FROM activities')
      expect(sql).toContain("activity_type = 'screentime'")
      expect(sql).not.toContain('FROM productivity')
    })

    test('joins the category path with " > " and matches exact-or-prefix', async () => {
      const deps = createDefaultEngineDeps()
      mockedQuery.mockResolvedValueOnce({ rows: [] } as never)

      await deps.getScreentime('user', ['Work', 'Programming'], window)

      const lastCall = mockedQuery.mock.calls[mockedQuery.mock.calls.length - 1]
      const params = lastCall[2] as unknown[]
      expect(params[0]).toBe('Work > Programming')
      const sql = lastCall[1] as string
      expect(sql).toContain("data->>'category_path' = $1")
      expect(sql).toContain("data->>'category_path' LIKE $1 || ' > %'")
    })

    test('returns TimeRange[] shaped results', async () => {
      const deps = createDefaultEngineDeps()
      mockedQuery.mockResolvedValueOnce({
        rows: [
          {
            end_time: new Date('2024-03-15T10:30:00Z'),
            start_time: new Date('2024-03-15T10:00:00Z'),
          },
        ],
      } as never)

      const result = await deps.getScreentime('user', ['Work'], window)
      expect(result).toEqual([
        {
          end: new Date('2024-03-15T10:30:00Z'),
          start: new Date('2024-03-15T10:00:00Z'),
        },
      ])
    })
  })
})
