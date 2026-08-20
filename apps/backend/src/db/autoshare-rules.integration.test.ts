import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
/**
 * Integration tests for the auto-share rule store (#903) and the feed-post
 * dedupe lookup, against a real database.
 */
import { insertActivity } from './activities/index.ts'
import {
  type AutoshareRuleInput,
  countAutosharePostsByRule,
  deleteAutoshareRule,
  getActivityIngestTimes,
  getAutoshareRules,
  getEnabledAutoshareRules,
  insertAutoshareRule,
  listAutoshareCandidates,
  listAutoshareSuppressedIds,
  updateAutoshareRule,
} from './autoshare-rules.ts'
import { query } from './connection.ts'
import { createFeedPost, deleteFeedPost, listFeedPostIdsByActivityIds } from './feed.ts'

const CONTAINER_TIMEOUT = 120_000

const ruleInput = (over: Partial<AutoshareRuleInput> = {}): AutoshareRuleInput => ({
  activity_types: ['running'],
  include_chart: false,
  include_map: true,
  included_metrics: ['duration', 'distance'],
  min_duration_seconds: 900,
  name: 'Runs > 15 min',
  series_metrics: ['heart_rate'],
  visibility: 'followers',
  ...over,
})

describe('Auto-share rules integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('rules are created DISABLED; enabling stamps enabled_at; disabling keeps it', async () => {
    const user = getTestUser()
    const created = await insertAutoshareRule(user, ruleInput())
    expect(created.enabled).toBe(false)
    expect(created.enabled_at).toBeNull()
    expect(created.min_duration_seconds).toBe(900)
    expect(created.activity_types).toEqual(['running'])
    expect(await getEnabledAutoshareRules(user)).toEqual([])

    const enabled = await updateAutoshareRule(user, created.id, { enabled: true })
    expect(enabled?.enabled).toBe(true)
    expect(enabled?.enabled_at).toBeInstanceOf(Date)
    expect((await getEnabledAutoshareRules(user)).map((r) => r.id)).toEqual([created.id])

    const disabled = await updateAutoshareRule(user, created.id, { enabled: false })
    expect(disabled?.enabled).toBe(false)
    // The gate stays — a later re-enable moves it FORWARD, never backwards.
    expect(disabled?.enabled_at).toEqual(enabled?.enabled_at)
  })

  test('patches predicate/template fields; null clears the nullable ones', async () => {
    const user = getTestUser()
    const created = await insertAutoshareRule(user, ruleInput())
    const updated = await updateAutoshareRule(user, created.id, {
      message: 'Auto-shared 🏃',
      min_distance_meters: 3000,
      min_duration_seconds: null,
      visibility: 'public',
    })
    expect(updated?.message).toBe('Auto-shared 🏃')
    expect(updated?.min_distance_meters).toBe(3000)
    expect(updated?.min_duration_seconds).toBeNull()
    expect(updated?.visibility).toBe('public')
  })

  test('deletes a rule; posts it created keep their marker and count', async () => {
    const user = getTestUser()
    const rule = await insertAutoshareRule(user, ruleInput())
    const activityId = await insertActivity(user, {
      activity_type: 'running',
      end_time: new Date('2026-08-01T08:30:00Z'),
      source: 'garmin',
      start_time: new Date('2026-08-01T08:00:00Z'),
    })
    await createFeedPost(user, {
      activity_id: activityId,
      autoshare_rule_id: rule.id,
      include_chart: false,
      include_map: false,
      included_metrics: ['duration'],
      series_metrics: [],
      visibility: 'followers',
    })
    expect(await countAutosharePostsByRule(user)).toEqual({ [rule.id]: 1 })

    expect(await deleteAutoshareRule(user, rule.id)).toBe(true)
    expect(await getAutoshareRules(user)).toEqual([])
    // The post survives (soft reference, like activity_id).
    expect(await countAutosharePostsByRule(user)).toEqual({ [rule.id]: 1 })
  })

  test('listFeedPostIdsByActivityIds finds posts referencing any group member (dedupe)', async () => {
    const user = getTestUser()
    const a1 = await insertActivity(user, {
      activity_type: 'running',
      end_time: new Date('2026-08-01T08:30:00Z'),
      source: 'garmin',
      start_time: new Date('2026-08-01T08:00:00Z'),
    })
    const a2 = await insertActivity(user, {
      activity_type: 'running',
      end_time: new Date('2026-08-01T09:30:00Z'),
      source: 'strava',
      start_time: new Date('2026-08-01T09:00:00Z'),
    })
    const post = await createFeedPost(user, {
      activity_id: a2,
      include_chart: false,
      include_map: false,
      included_metrics: ['duration'],
      series_metrics: [],
      visibility: 'public',
    })
    expect(await listFeedPostIdsByActivityIds(user, [a1, a2])).toEqual([post.id])
    expect(await listFeedPostIdsByActivityIds(user, [a1])).toEqual([])
    expect(await listFeedPostIdsByActivityIds(user, [])).toEqual([])
  })

  test('deleting an activity post records a suppression that survives the hard delete', async () => {
    const user = getTestUser()
    const activityId = await insertActivity(user, {
      activity_type: 'running',
      end_time: new Date('2026-08-01T08:30:00Z'),
      source: 'garmin',
      start_time: new Date('2026-08-01T08:00:00Z'),
    })
    const post = await createFeedPost(user, {
      activity_id: activityId,
      include_chart: false,
      include_map: false,
      included_metrics: ['duration'],
      series_metrics: [],
      visibility: 'public',
    })
    expect(await listAutoshareSuppressedIds(user, [activityId])).toEqual([])

    expect(await deleteFeedPost(user, post.id)).toBe(true)
    // The post row is gone, but the suppression keeps the dedupe intact (#903).
    expect(await listFeedPostIdsByActivityIds(user, [activityId])).toEqual([])
    expect(await listAutoshareSuppressedIds(user, [activityId])).toEqual([activityId])
    expect(await listAutoshareSuppressedIds(user, [])).toEqual([])
  })

  test('candidates: bounded, non-deleted activities overlapping the window, with ingest times', async () => {
    const user = getTestUser()
    const inWindow = await insertActivity(user, {
      activity_type: 'running',
      end_time: new Date('2026-08-01T08:30:00Z'),
      source: 'garmin',
      start_time: new Date('2026-08-01T08:00:00Z'),
    })
    // Open-ended (no end): not a candidate.
    await insertActivity(user, {
      activity_type: 'running',
      source: 'garmin',
      start_time: new Date('2026-08-01T08:10:00Z'),
    })
    // Outside the window: not a candidate.
    await insertActivity(user, {
      activity_type: 'running',
      end_time: new Date('2026-08-03T08:30:00Z'),
      source: 'garmin',
      start_time: new Date('2026-08-03T08:00:00Z'),
    })
    // Superseded (cross-source/override merge loser): not a candidate — the
    // same-type grouping can't see across types, so evaluating the loser too
    // would double-post one physical session.
    const superseded = await insertActivity(user, {
      activity_type: 'walking',
      end_time: new Date('2026-08-01T08:30:00Z'),
      source: 'health_connect',
      start_time: new Date('2026-08-01T08:00:00Z'),
    })
    await query(user, `UPDATE activities SET superseded_by = $1 WHERE id = $2`, [inWindow, superseded])

    const candidates = await listAutoshareCandidates(
      user,
      new Date('2026-08-01T00:00:00Z'),
      new Date('2026-08-01T23:59:59Z'),
    )
    expect(candidates.map((c) => c.id)).toEqual([inWindow])
    expect(candidates[0].created_at).toBeInstanceOf(Date)

    const times = await getActivityIngestTimes(user, [inWindow])
    expect(times[inWindow]).toBeInstanceOf(Date)
  })
})
