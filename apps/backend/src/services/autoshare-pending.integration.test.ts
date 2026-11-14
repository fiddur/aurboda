import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { AutoshareCandidate, AutoshareRuleRecord } from '../db/index.ts'
import type { AutoshareGroupMember } from './autoshare-deps.ts'

import { insertActivity } from '../db/activities/index.ts'
import { createFeedPost } from '../db/feed.ts'
import { insertNotification, reviseNotification } from '../db/notifications.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { createAutoshareDeps, getAutoshareGroup } from './autoshare-deps.ts'
import { AUTOSHARE_SKIP_ACTION, autosharePendingDedupeKey } from './autoshare-notifications.ts'
import { autoshareSharedByHand, withdrawRuleAutoshares } from './autoshare-pending.ts'
import { notifier } from './notifications.ts'

const CONTAINER_TIMEOUT = 120_000

const T0 = new Date('2026-08-01T08:00:00Z')
const MINUTE = 60_000

const rule = (over: Partial<AutoshareRuleRecord> = {}): AutoshareRuleRecord => ({
  activity_types: ['running'],
  created_at: T0,
  data_filters: [],
  delay_minutes: 10,
  enabled: true,
  enabled_at: T0,
  id: '9d0124e7-d161-4855-a54f-fa8bdb45c4f2',
  include_chart: false,
  include_exercises: false,
  include_map: false,
  included_metrics: [],
  max_age_hours: 24,
  max_duration_seconds: null,
  message: null,
  min_distance_meters: null,
  min_duration_seconds: null,
  name: 'Runs',
  series_metrics: [],
  source: null,
  tags: null,
  updated_at: T0,
  visibility: 'followers',
  ...over,
})

const insertRun = (user: string, startMinutes: number, endMinutes: number): Promise<string> =>
  insertActivity(user, {
    activity_type: 'running',
    end_time: new Date(T0.getTime() + endMinutes * MINUTE),
    source: startMinutes === 0 ? 'garmin' : 'strava',
    start_time: new Date(T0.getTime() + startMinutes * MINUTE),
  })

const groupOf = (user: string, id: string): Promise<AutoshareGroupMember[]> =>
  getAutoshareGroup(user, { created_at: T0, end_time: T0, id } as AutoshareCandidate)

const stored = (user: string, key: string) => reviseNotification(user, { dedupe_key: key }, {})

const info = { detail_pending: false, share_at: new Date(Date.now() + 10 * MINUTE) }

describe('pending-share notifications', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const deps = createAutoshareDeps(() => {}, notifier)

  test('a group whose anchor changed keeps its first announcement, revised, instead of a second', async () => {
    const user = getTestUser()
    const later = await insertRun(user, 10, 60)
    const [alone] = await groupOf(user, later)
    expect(await deps.announce!(user, alone!, rule(), info, [alone!])).toBe(true)

    const earlier = await insertRun(user, 0, 40)
    const group = await groupOf(user, later)
    expect(group.map((member) => member.id)).toEqual([earlier, later])
    expect(await deps.announce!(user, group[0]!, rule(), info, group)).toBe(false)

    expect(await stored(user, autosharePendingDedupeKey(earlier))).toBeNull()
    expect(await stored(user, autosharePendingDedupeKey(later))).toMatchObject({
      actions: [AUTOSHARE_SKIP_ACTION],
      data: { activity_id: earlier },
      link: `/detail/activity/${earlier}`,
    })
  })

  test('a withdrawn group says it will not be shared, and a new match announces it afresh', async () => {
    const user = getTestUser()
    const id = await insertRun(user, 0, 40)
    const group = await groupOf(user, id)
    const key = autosharePendingDedupeKey(id)
    await deps.announce!(user, group[0]!, rule(), info, group)

    await deps.withdrawn!(user, group)
    expect(await stored(user, key)).toBeNull()

    expect(await deps.announce!(user, group[0]!, rule(), info, group)).toBe(true)
    expect(await stored(user, key)).toMatchObject({ actions: [AUTOSHARE_SKIP_ACTION] })
  })

  test('a withdrawn notification keeps its row, closed', async () => {
    const user = getTestUser()
    const id = await insertRun(user, 0, 40)
    const group = await groupOf(user, id)
    await deps.announce!(user, group[0]!, rule(), info, group)
    const raised = await stored(user, autosharePendingDedupeKey(id))

    await deps.withdrawn!(user, group)
    expect(await reviseNotification(user, { id: raised!.id }, {})).toMatchObject({
      actions: [],
      dedupe_key: null,
      title: 'Your running will not be shared',
    })
  })

  test('disabling a rule closes its open notifications and leaves other rules alone', async () => {
    const user = getTestUser()
    const pending = (key: string, ruleId: string, label: string) =>
      insertNotification(user, {
        actions: [AUTOSHARE_SKIP_ACTION],
        data: { activity_id: key, activity_label: label, rule_id: ruleId },
        dedupe_key: autosharePendingDedupeKey(key),
        in_app: true,
        push: true,
        title: `Your new ${label} will be shared in about 5 minutes`,
        type: 'autoshare_pending',
      })
    const run = await pending('a1', 'r1', 'running')
    const walk = await pending('a2', 'r1', 'walking')
    const other = await pending('a3', 'r2', 'running')

    await withdrawRuleAutoshares(user, 'r1')

    expect(await reviseNotification(user, { id: run!.id }, {})).toMatchObject({
      actions: [],
      title: 'Your running will not be shared',
    })
    expect(await reviseNotification(user, { id: walk!.id }, {})).toMatchObject({
      actions: [],
      title: 'Your walking will not be shared',
    })
    expect(await reviseNotification(user, { id: other!.id }, {})).toMatchObject({
      actions: [AUTOSHARE_SKIP_ACTION],
    })
  })

  test('a share by hand of any group member revises the open notification to "was shared"', async () => {
    const user = getTestUser()
    const anchor = await insertRun(user, 0, 40)
    const member = await insertRun(user, 10, 60)
    const group = await groupOf(user, anchor)
    await deps.announce!(user, group[0]!, rule(), info, group)

    const post = await createFeedPost(user, {
      activity_id: member,
      include_chart: false,
      include_map: false,
      included_metrics: [],
      series_metrics: [],
      visibility: 'public',
    })
    await autoshareSharedByHand(user, post, 'running')

    expect(await stored(user, autosharePendingDedupeKey(anchor))).toMatchObject({
      actions: [],
      link: `/u/${user}/posts/${post.id}`,
      title: 'Your running was shared',
    })
  })
})
