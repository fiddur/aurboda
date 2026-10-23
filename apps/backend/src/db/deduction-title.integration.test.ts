import type { DeductionRule } from '@aurboda/api-spec'

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import type { Activity } from './types.ts'

import { createDefaultEngineDeps } from '../services/deduction-deps.ts'
import { evaluateRule } from '../services/deduction-engine.ts'
import { updateActivity } from '../services/mutations.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { query } from './connection.ts'
import { getActivityById, getOverrideForActivity, insertActivity } from './index.ts'

const CONTAINER_TIMEOUT = 120_000

const window = { end: new Date('2026-09-26T00:00:00Z'), start: new Date('2026-09-25T00:00:00Z') }
const SESSION = 'Heart-Opening Yin Yoga with Jade'

const garminYoga = (overrides: Partial<Activity> = {}): Activity => ({
  activity_type: 'yoga',
  data: { garmin_activity_id: 24497411117, session_name: SESSION },
  end_time: new Date('2026-09-25T19:00:00Z'),
  external_id: 'garmin-activity-24497411117',
  source: 'garmin',
  start_time: new Date('2026-09-25T18:00:00Z'),
  title: 'Yoga',
  ...overrides,
})

const rule: DeductionRule = {
  conditions: [
    {
      activity_type: 'yoga',
      data_filters: [{ field: 'session_name', operator: 'exists' }],
      kind: 'activity',
    },
  ],
  enabled: true,
  id: '7d3f1c2a-6b4e-4f0a-9c1d-2e5b8a7f6c30',
  mode: 'enrich',
  name: 'Yoga title from session',
  output_activity_type: 'yoga',
  output_title_field: 'session_name',
  priority: 0,
}

describe('enrich rules with output_title_field (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('a synced activity gets an override titled by the field that survives a re-sync', async () => {
    const user = getTestUser()
    const syncedId = await insertActivity(user, garminYoga())
    const deps = createDefaultEngineDeps()

    expect((await evaluateRule(user, rule, window, deps)).affected_ids).toEqual([syncedId])

    const override = await getOverrideForActivity(user, syncedId)
    expect(override).toMatchObject({ activity_type: 'yoga', source: 'aurboda', title: SESSION })
    expect(override?.data).toMatchObject({
      _titled_by: rule.id,
      _titled_value: SESSION,
      garmin_activity_id: 24497411117,
      session_name: SESSION,
    })

    await insertActivity(user, garminYoga())
    expect((await getActivityById(user, syncedId))?.title).toBe('Yoga')
    const afterSync = await getOverrideForActivity(user, syncedId)
    expect(afterSync).toMatchObject({ id: override?.id, title: SESSION })

    expect((await evaluateRule(user, rule, window, deps)).affected_ids).toEqual([])
  })

  test('the title follows the field while the rule owns it, not once someone renamed it', async () => {
    const user = getTestUser()
    const syncedId = await insertActivity(user, garminYoga())
    const deps = createDefaultEngineDeps()
    await evaluateRule(user, rule, window, deps)
    const overrideId = (await getOverrideForActivity(user, syncedId))?.id ?? 'no-override'

    const setSession = (name: string) =>
      query(user, `UPDATE activities SET data = data || $2::jsonb WHERE id = $1`, [
        overrideId,
        JSON.stringify({ session_name: name }),
      ])

    await setSession('Power Flow')
    expect((await evaluateRule(user, rule, window, deps)).affected_ids).toEqual([overrideId])
    expect((await getActivityById(user, overrideId))?.title).toBe('Power Flow')

    expect((await updateActivity(user, overrideId, { title: 'My own name' })).success).toBe(true)
    await setSession('Something else')
    expect((await evaluateRule(user, rule, window, deps)).affected_ids).toEqual([])
    expect((await getActivityById(user, overrideId))?.title).toBe('My own name')
  })

  test('a hand-typed title is not replaced', async () => {
    const user = getTestUser()
    const syncedId = await insertActivity(user, garminYoga({ title: 'Morning flow' }))

    expect((await evaluateRule(user, rule, window, createDefaultEngineDeps())).affected_ids).toEqual([])
    expect(await getOverrideForActivity(user, syncedId)).toBeNull()
    expect((await getActivityById(user, syncedId))?.title).toBe('Morning flow')
  })

  test('an aurboda activity is retitled in place, keeping its data', async () => {
    const user = getTestUser()
    const id = await insertActivity(
      user,
      garminYoga({
        data: { session_name: SESSION, style: 'yin' },
        external_id: undefined,
        source: 'aurboda',
      }),
    )

    expect((await evaluateRule(user, rule, window, createDefaultEngineDeps())).affected_ids).toEqual([id])
    expect(await getActivityById(user, id)).toMatchObject({
      data: { _titled_by: rule.id, _titled_value: SESSION, session_name: SESSION, style: 'yin' },
      title: SESSION,
    })
  })

  test('a dry run counts without writing', async () => {
    const user = getTestUser()
    const syncedId = await insertActivity(user, garminYoga())

    expect((await evaluateRule(user, rule, window, createDefaultEngineDeps(), true)).would_affect).toBe(1)
    expect(await getOverrideForActivity(user, syncedId)).toBeNull()
  })

  test('the rule-tagged notifier keeps the rule from re-triggering itself', async () => {
    const user = getTestUser()
    await insertActivity(user, garminYoga())
    const notifier = vi.fn()

    await evaluateRule(user, rule, window, createDefaultEngineDeps(notifier))

    expect(notifier).toHaveBeenCalled()
    for (const call of notifier.mock.calls) expect(call[4]).toBe(rule.id)
  })

  test('a hand-typed override title is kept when the synced target has lost its superseded_by mark (#1258)', async () => {
    const user = getTestUser()
    const syncedId = await insertActivity(user, garminYoga())
    const deps = createDefaultEngineDeps()
    await evaluateRule(user, rule, window, deps)
    const overrideId = (await getOverrideForActivity(user, syncedId))?.id ?? 'no-override'
    expect((await updateActivity(user, overrideId, { title: 'Hand typed' })).success).toBe(true)

    await query(user, `UPDATE activities SET superseded_by = NULL WHERE id = $1`, [syncedId])

    expect((await evaluateRule(user, rule, window, deps)).affected_ids).toEqual([])
    expect((await getActivityById(user, overrideId))?.title).toBe('Hand typed')
    expect((await getActivityById(user, syncedId))?.title).toBe('Yoga')
  })
})
