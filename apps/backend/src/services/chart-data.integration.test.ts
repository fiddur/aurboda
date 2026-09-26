import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { query } from '../db/connection.ts'
import { insertActivity } from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getChartData } from './chart-data.ts'
import { createDefaultEngineDeps } from './deduction-deps.ts'
import { createCategory } from './screentime-categories.ts'

const CONTAINER_TIMEOUT = 120_000

const span = (activity_type: string, category_path: string, start: string, end: string) => ({
  activity_type,
  data: { category_path },
  end_time: new Date(end),
  source: 'activitywatch' as const,
  start_time: new Date(start),
})

describe('screentime category chart data', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    await query(getTestUser(), `DELETE FROM activity_type_definitions WHERE is_builtin = false`)
  })

  test('buckets spans stored under per-category types and the legacy umbrella type', async () => {
    const user = getTestUser()
    await createCategory(user, { name: ['Work'], rule_type: 'none' })
    const child = await createCategory(user, { name: ['Work', 'Dev'], rule_regex: 'vim', rule_type: 'regex' })
    const other = await createCategory(user, { name: ['Games'], rule_regex: 'steam', rule_type: 'regex' })

    await insertActivity(
      user,
      span(child.activity_type_name!, 'Work > Dev', '2026-06-01T08:00:00Z', '2026-06-01T09:00:00Z'),
    )
    await insertActivity(user, span('screentime', 'Work', '2026-06-01T10:00:00Z', '2026-06-01T10:30:00Z'))
    await insertActivity(
      user,
      span(other.activity_type_name!, 'Games', '2026-06-01T11:00:00Z', '2026-06-01T12:00:00Z'),
    )

    const result = await getChartData(user, {
      aggregation: 'sum',
      bucket_size: '1d',
      end: '2026-06-02T00:00:00Z',
      pattern: 'Work',
      source_type: 'productivity_category',
      start: '2026-06-01T00:00:00Z',
    })

    expect(result.buckets).toEqual([{ bucket_start: '2026-06-01T00:00:00.000Z', value: 1.5 }])
  })

  test('ignores non-screentime activities of a linked type without a matching category_path', async () => {
    const user = getTestUser()
    const cat = await createCategory(user, { name: ['Porn'], rule_regex: 'x', rule_type: 'regex' })
    await insertActivity(
      user,
      span(cat.activity_type_name!, 'Porn', '2026-06-01T08:00:00Z', '2026-06-01T08:15:00Z'),
    )
    await insertActivity(user, {
      activity_type: cat.activity_type_name!,
      end_time: new Date('2026-06-01T09:00:00Z'),
      source: 'manual',
      start_time: new Date('2026-06-01T08:30:00Z'),
    })

    const result = await getChartData(user, {
      aggregation: 'sum',
      bucket_size: '1d',
      end: '2026-06-02T00:00:00Z',
      pattern: 'Porn',
      source_type: 'productivity_category',
      start: '2026-06-01T00:00:00Z',
    })

    expect(result.buckets).toEqual([{ bucket_start: '2026-06-01T00:00:00.000Z', value: 0.25 }])
  })

  test('deduction screentime condition sees per-category typed spans', async () => {
    const user = getTestUser()
    const cat = await createCategory(user, { name: ['Porn'], rule_regex: 'x', rule_type: 'regex' })
    await insertActivity(
      user,
      span(cat.activity_type_name!, 'Porn', '2026-06-01T08:00:00Z', '2026-06-01T08:15:00Z'),
    )

    const ranges = await createDefaultEngineDeps().getScreentime(user, ['Porn'], {
      end: new Date('2026-06-02T00:00:00Z'),
      start: new Date('2026-06-01T00:00:00Z'),
    })

    expect(ranges).toHaveLength(1)
  })
})
