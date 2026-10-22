import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { ScreentimeCategory } from '../db/types.ts'

import { query } from '../db/connection.ts'
import {
  deleteScreentimeCategoryWithChildren,
  insertActivity,
  insertProductivity,
  insertScreentimeCategory,
  updateScreentimeCategory,
} from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { rebuildScreentimeSpans } from './rebuild-screentime-spans.ts'
import { recategorizeAll } from './screentime-categories.ts'
import { ensureAllCategoriesHaveTypes } from './screentime-category-sync.ts'

const CONTAINER_TIMEOUT = 120_000

const START = new Date('2026-06-01T08:00:00Z')
const START_MS = START.getTime()
const END = new Date(START_MS + 30 * 60_000)

const records = (activity: string, resolved_category?: string[]) =>
  [0, 1, 2].map((i) => ({
    activity,
    device_name: '',
    duration_sec: 600,
    end_time: new Date(START_MS + (i + 1) * 10 * 60_000),
    source: 'activitywatch' as const,
    start_time: new Date(START_MS + i * 10 * 60_000),
    ...(resolved_category ? { resolved_category } : {}),
  }))

const span = (activity_type: string, external_id: string, category_path: string) => ({
  activity_type,
  data: { category_path },
  end_time: END,
  external_id,
  source: 'activitywatch' as const,
  start_time: START,
})

// Categories are inserted through the db layer, not createCategory, so no background
// recategorization races the assertions.
const makeCategories = async (
  user: string,
): Promise<{ dev: ScreentimeCategory; games: ScreentimeCategory }> => {
  const dev = await insertScreentimeCategory(user, {
    name: ['Work', 'Dev'],
    rule_regex: 'vim',
    rule_type: 'regex',
  })
  const games = await insertScreentimeCategory(user, {
    name: ['Games'],
    rule_regex: 'steam',
    rule_type: 'regex',
  })
  await ensureAllCategoriesHaveTypes(user, [dev, games])
  return { dev, games }
}

const liveSpans = async () => {
  const result = await query(
    getTestUser(),
    `SELECT id, activity_type, external_id FROM activities
      WHERE deleted_at IS NULL AND source = 'activitywatch' ORDER BY activity_type`,
  )
  return result.rows as Array<{ id: string; activity_type: string; external_id: string }>
}

const getRow = async (id: string) => {
  const result = await query(
    getTestUser(),
    `SELECT activity_type, external_id, deleted_at FROM activities WHERE id = $1`,
    [id],
  )
  return result.rows[0] as { activity_type: string; external_id: string | null; deleted_at: Date | null }
}

describe('rebuildScreentimeSpans', () => {
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

  test('recategorizeAll moves spans to the category the records now resolve to', async () => {
    const user = getTestUser()
    const { dev, games } = await makeCategories(user)
    await insertProductivity(user, records('vim'))

    const first = await recategorizeAll(user)
    expect(first).toEqual({ records_updated: 3, spans: { deduplicated: 0, removed: 0, upserted: 1 } })
    const before = await liveSpans()
    expect(before).toEqual([
      {
        activity_type: dev.activity_type_name,
        external_id: `activitywatch_${START_MS}_${dev.activity_type_name}`,
        id: expect.any(String),
      },
    ])

    await updateScreentimeCategory(user, dev.id, { rule_regex: 'emacs' })
    await updateScreentimeCategory(user, games.id, { rule_regex: 'steam|vim' })

    const second = await recategorizeAll(user)
    expect(second).toEqual({ records_updated: 3, spans: { deduplicated: 0, removed: 1, upserted: 1 } })
    expect((await getRow(before[0].id)).deleted_at).not.toBeNull()
    expect(await liveSpans()).toEqual([
      {
        activity_type: games.activity_type_name,
        external_id: `activitywatch_${START_MS}_${games.activity_type_name}`,
        id: expect.any(String),
      },
    ])

    expect(await recategorizeAll(user)).toEqual({ records_updated: 3 })
  })

  test('rewrites a retyped v1 span to the v2 identity and upserts onto it', async () => {
    const user = getTestUser()
    const { dev } = await makeCategories(user)
    await insertProductivity(user, records('vim', ['Work', 'Dev']))
    const v1Id = await insertActivity(
      user,
      span(dev.activity_type_name!, `activitywatch_${START_MS}_Work > Dev`, 'Work > Dev'),
    )

    const result = await rebuildScreentimeSpans(user)

    expect(result).toEqual({ deduplicated: 0, removed: 0, upserted: 1 })
    expect(await getRow(v1Id)).toEqual({
      activity_type: dev.activity_type_name,
      deleted_at: null,
      external_id: `activitywatch_${START_MS}_${dev.activity_type_name}`,
    })
    expect((await liveSpans()).map((r) => r.id)).toEqual([v1Id])
  })

  test('soft-deletes a v1 span that has a live v2 twin and keeps the twin', async () => {
    const user = getTestUser()
    const { dev } = await makeCategories(user)
    await insertProductivity(user, records('vim', ['Work', 'Dev']))
    const v1Id = await insertActivity(
      user,
      span(dev.activity_type_name!, `activitywatch_${START_MS}_Work > Dev`, 'Work > Dev'),
    )
    const v2Id = await insertActivity(
      user,
      span(dev.activity_type_name!, `activitywatch_${START_MS}_${dev.activity_type_name}`, 'Work > Dev'),
    )

    const result = await rebuildScreentimeSpans(user)

    expect(result).toEqual({ deduplicated: 1, removed: 0, upserted: 1 })
    expect((await getRow(v1Id)).deleted_at).not.toBeNull()
    expect((await liveSpans()).map((r) => r.id)).toEqual([v2Id])
  })

  const v1WithV2Tombstone = async (user: string, dev: ScreentimeCategory) => {
    const v1Id = await insertActivity(
      user,
      span(dev.activity_type_name!, `activitywatch_${START_MS}_Work > Dev`, 'Work > Dev'),
    )
    const v2Id = await insertActivity(
      user,
      span(dev.activity_type_name!, `activitywatch_${START_MS}_${dev.activity_type_name}`, 'Work > Dev'),
    )
    await query(user, `UPDATE activities SET deleted_at = NOW() WHERE id = $1`, [v2Id])
    return { v1Id, v2Id }
  }

  test('revives a soft-deleted v2 twin the records produce and soft-deletes the v1 span', async () => {
    const user = getTestUser()
    const { dev } = await makeCategories(user)
    await insertProductivity(user, records('vim', ['Work', 'Dev']))
    const { v1Id, v2Id } = await v1WithV2Tombstone(user, dev)

    const result = await rebuildScreentimeSpans(user)

    expect(result).toEqual({ deduplicated: 1, removed: 0, upserted: 1 })
    expect((await getRow(v1Id)).deleted_at).not.toBeNull()
    expect((await liveSpans()).map((r) => r.id)).toEqual([v2Id])
  })

  test('leaves a v1 span whose v2 id is taken by a tombstone nothing produces to the stale sweep', async () => {
    const user = getTestUser()
    const { dev } = await makeCategories(user)
    const { v1Id } = await v1WithV2Tombstone(user, dev)

    const result = await rebuildScreentimeSpans(user)

    expect(result).toEqual({ deduplicated: 0, removed: 1, upserted: 0 })
    expect((await getRow(v1Id)).deleted_at).not.toBeNull()
    expect(await liveSpans()).toEqual([])
  })

  test('a record recategorized away and back revives its original span', async () => {
    const user = getTestUser()
    const { dev, games } = await makeCategories(user)
    await insertProductivity(user, records('vim'))
    await recategorizeAll(user)
    const [devSpan] = await liveSpans()

    await updateScreentimeCategory(user, dev.id, { rule_regex: 'emacs' })
    await updateScreentimeCategory(user, games.id, { rule_regex: 'steam|vim' })
    expect((await recategorizeAll(user)).spans).toEqual({ deduplicated: 0, removed: 1, upserted: 1 })
    const [gamesSpan] = await liveSpans()

    await updateScreentimeCategory(user, dev.id, { rule_regex: 'vim' })
    await updateScreentimeCategory(user, games.id, { rule_regex: 'steam' })
    expect((await recategorizeAll(user)).spans).toEqual({ deduplicated: 0, removed: 1, upserted: 1 })

    expect(await liveSpans()).toEqual([devSpan])
    expect((await getRow(gamesSpan.id)).deleted_at).not.toBeNull()
  })

  test('removes the span of a deleted category and re-derives it under the parent', async () => {
    const user = getTestUser()
    const work = await insertScreentimeCategory(user, {
      name: ['Work'],
      rule_regex: 'vim|code',
      rule_type: 'regex',
    })
    const dev = await insertScreentimeCategory(user, {
      name: ['Work', 'Dev'],
      rule_regex: 'vim',
      rule_type: 'regex',
    })
    await ensureAllCategoriesHaveTypes(user, [work, dev])
    await insertProductivity(user, records('vim'))
    await recategorizeAll(user)
    const [devSpan] = await liveSpans()
    expect(devSpan.activity_type).toBe(dev.activity_type_name)

    await deleteScreentimeCategoryWithChildren(user, dev.id)
    const result = await recategorizeAll(user)

    expect(result).toEqual({ records_updated: 3, spans: { deduplicated: 0, removed: 1, upserted: 1 } })
    expect((await getRow(devSpan.id)).deleted_at).not.toBeNull()
    expect(await liveSpans()).toEqual([
      {
        activity_type: work.activity_type_name,
        external_id: `activitywatch_${START_MS}_${work.activity_type_name}`,
        id: expect.any(String),
      },
    ])
  })

  test('removes a span whose records are gone and leaves other activities alone', async () => {
    const user = getTestUser()
    await makeCategories(user)
    await insertProductivity(user, records('vim', ['Work', 'Dev']))
    expect(await rebuildScreentimeSpans(user)).toEqual({ deduplicated: 0, removed: 0, upserted: 1 })
    const [spanRow] = await liveSpans()

    const runId = await insertActivity(user, {
      activity_type: 'running',
      end_time: END,
      external_id: 'strava-run-1',
      source: 'strava',
      start_time: START,
    })
    const rescuetimeRunId = await insertActivity(user, {
      activity_type: 'running',
      end_time: END,
      external_id: `rescuetime_${START_MS}_running`,
      source: 'rescuetime',
      start_time: START,
    })
    await query(user, `UPDATE productivity SET deleted_at = NOW()`)

    const result = await rebuildScreentimeSpans(user)

    expect(result).toEqual({ deduplicated: 0, removed: 1, upserted: 0 })
    expect((await getRow(spanRow.id)).deleted_at).not.toBeNull()
    expect((await getRow(runId)).deleted_at).toBeNull()
    expect((await getRow(rescuetimeRunId)).deleted_at).toBeNull()
  })

  test('leaves a span alone whose category path already is its slug', async () => {
    const user = getTestUser()
    const games = await insertScreentimeCategory(user, {
      name: ['games'],
      rule_regex: 'steam',
      rule_type: 'regex',
    })
    await ensureAllCategoriesHaveTypes(user, [games])
    expect(games.activity_type_name).toBe('games')
    await insertProductivity(user, records('steam', ['games']))

    expect(await rebuildScreentimeSpans(user)).toEqual({ deduplicated: 0, removed: 0, upserted: 1 })
    const [first] = await liveSpans()
    expect(await rebuildScreentimeSpans(user)).toEqual({ deduplicated: 0, removed: 0, upserted: 1 })

    expect(await liveSpans()).toEqual([first])
  })

  test('runs concurrent rebuilds one after the other', async () => {
    const user = getTestUser()
    await makeCategories(user)
    await insertProductivity(user, records('vim', ['Work', 'Dev']))

    const results = await Promise.all([rebuildScreentimeSpans(user), rebuildScreentimeSpans(user)])

    expect(results).toEqual([
      { deduplicated: 0, removed: 0, upserted: 1 },
      { deduplicated: 0, removed: 0, upserted: 1 },
    ])
    expect(await liveSpans()).toHaveLength(1)
  })

  test('keeps a span created after the record snapshot, for the next rebuild', async () => {
    const user = getTestUser()
    const { dev } = await makeCategories(user)
    const slug = dev.activity_type_name
    if (!slug) throw new Error('category has no activity type')
    const lateId = await insertActivity(user, span(slug, `activitywatch_${START_MS}_${slug}`, 'Work > Dev'))

    const result = await rebuildScreentimeSpans(user, { now: () => new Date(Date.now() - 60_000) })

    expect(result).toEqual({ deduplicated: 0, removed: 0, upserted: 0 })
    expect((await getRow(lateId)).deleted_at).toBeNull()
  })

  test('removes every span once the last category is gone', async () => {
    const user = getTestUser()
    const { dev, games } = await makeCategories(user)
    await insertProductivity(user, records('vim', ['Work', 'Dev']))
    expect(await rebuildScreentimeSpans(user)).toEqual({ deduplicated: 0, removed: 0, upserted: 1 })
    await deleteScreentimeCategoryWithChildren(user, dev.id)
    await deleteScreentimeCategoryWithChildren(user, games.id)

    expect(await recategorizeAll(user)).toEqual({
      records_updated: 3,
      spans: { deduplicated: 0, removed: 1, upserted: 0 },
    })
    expect(await liveSpans()).toEqual([])
  })
})
