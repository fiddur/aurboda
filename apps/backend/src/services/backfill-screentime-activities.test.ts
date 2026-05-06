import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../db/index', () => ({
  getScreentimeCategories: vi.fn(),
  getSyncState: vi.fn(),
  insertActivities: vi.fn().mockResolvedValue(undefined),
  upsertSyncState: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../db/connection', () => ({
  query: vi.fn(),
}))

vi.mock('./audit-log.ts', () => ({
  auditError: vi.fn(),
  auditInfo: vi.fn(),
  auditWarn: vi.fn(),
}))

import { query } from '../db/connection.ts'
import { getScreentimeCategories, getSyncState, insertActivities, upsertSyncState } from '../db/index.ts'
import { backfillScreentimeActivities } from './backfill-screentime-activities.ts'

const mockedGetSyncState = vi.mocked(getSyncState)
const mockedGetScreentimeCategories = vi.mocked(getScreentimeCategories)
const mockedQuery = vi.mocked(query)
const mockedInsertActivities = vi.mocked(insertActivities)
const mockedUpsertSyncState = vi.mocked(upsertSyncState)

const cat = (name: string[], activityTypeName?: string) => ({
  ...(activityTypeName ? { activity_type_name: activityTypeName } : {}),
  created_at: new Date(),
  id: `cat-${name.join('-')}`,
  ignore_case: true,
  name,
  rule_type: 'regex' as const,
  sort_order: 0,
  updated_at: new Date(),
})

describe('backfillScreentimeActivities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetSyncState.mockResolvedValue(null)
    // Categories enter the backfill already linked (slug set). The lazy
    // ensure inside backfill is then a no-op — keeps the mock minimal.
    mockedGetScreentimeCategories.mockResolvedValue([cat(['Work'], 'work')])
    // Default: any unspecified query returns an empty result set.
    mockedQuery.mockResolvedValue({ rows: [] } as never)
  })

  test('short-circuits when sync_state marks backfill as completed', async () => {
    mockedGetSyncState.mockResolvedValueOnce({
      last_sync_time: new Date('2026-04-21T00:00:00Z'),
      status: 'idle',
    } as never)

    const result = await backfillScreentimeActivities('user')

    expect(result).toEqual({ created: 0, reason: 'already_completed', skipped: true })
    expect(mockedQuery).not.toHaveBeenCalled()
    expect(mockedInsertActivities).not.toHaveBeenCalled()
  })

  test('marks backfill complete when the user has no categories yet', async () => {
    mockedGetScreentimeCategories.mockResolvedValueOnce([])

    const result = await backfillScreentimeActivities('user')

    expect(result).toEqual({ created: 0, reason: 'no_categories', skipped: true })
    expect(mockedQuery).not.toHaveBeenCalled()
    expect(mockedUpsertSyncState).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({ data_type: 'screentime_backfill', status: 'idle' }),
    )
  })

  test('marks backfill complete when there are no productivity records', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as never)

    const result = await backfillScreentimeActivities('user')

    expect(result).toEqual({ created: 0, reason: 'no_records', skipped: true })
    expect(mockedInsertActivities).not.toHaveBeenCalled()
    expect(mockedUpsertSyncState).toHaveBeenCalled()
  })

  test('builds spans and upserts activities for existing productivity', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          activity: 'vscode',
          duration_sec: 600,
          end_time: '2026-04-10T10:10:00Z',
          resolved_category: ['Work'],
          source: 'rescuetime',
          start_time: '2026-04-10T10:00:00Z',
          title: null,
        },
        {
          activity: 'vscode',
          duration_sec: 600,
          end_time: '2026-04-10T10:20:00Z',
          resolved_category: ['Work'],
          source: 'rescuetime',
          start_time: '2026-04-10T10:10:00Z',
          title: null,
        },
      ],
    } as never)

    const result = await backfillScreentimeActivities('user')

    expect(result.skipped).toBe(false)
    expect(result.created).toBe(1) // the two records merge into one span
    expect(mockedInsertActivities).toHaveBeenCalledWith(
      'user',
      expect.arrayContaining([
        expect.objectContaining({
          activity_type: 'work',
          source: 'rescuetime',
          data: expect.objectContaining({ category_path: 'Work' }),
        }),
      ]),
    )
    expect(mockedUpsertSyncState).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({ data_type: 'screentime_backfill', status: 'idle' }),
    )
  })
})
