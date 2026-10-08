import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  activityTypeExists,
  getActivities,
  insertActivity,
  insertActivityTypeDefinition,
  insertDeductionRule,
} from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { createDefaultEngineDeps } from './deduction-deps.ts'
import { evaluateAllRules } from './deduction-engine.ts'

const CONTAINER_TIMEOUT = 120_000

const window = { end: new Date('2026-09-18T00:00:00Z'), start: new Date('2026-09-17T00:00:00Z') }

const ensureType = async (user: string, name: string) => {
  if (await activityTypeExists(user, name)) return
  await insertActivityTypeDefinition(user, { display_category: 'other', display_name: name, name })
}

describe('create-mode rules re-evaluating a settled window (#1236)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('only the first pass notifies, so the rules cannot re-trigger each other', async () => {
    const user = getTestUser()
    await ensureType(user, 'holosync')
    await ensureType(user, 'vocal_training')
    await insertActivity(user, {
      activity_type: 'meditation',
      end_time: new Date('2026-09-17T15:20:08Z'),
      source: 'aurboda',
      start_time: new Date('2026-09-17T14:47:22Z'),
    })
    const rules = await Promise.all(
      ['holosync', 'vocal_training'].map((output) =>
        insertDeductionRule(user, {
          conditions: [{ activity_type: 'meditation', kind: 'activity' }],
          name: output,
          output_activity_type: output,
        }),
      ),
    )
    const notifier = vi.fn()
    const deps = createDefaultEngineDeps(notifier)

    await evaluateAllRules(user, rules, window, deps)
    expect(notifier.mock.calls.map((call) => call[4]).sort()).toEqual(rules.map((r) => r.id).sort())

    notifier.mockClear()
    await evaluateAllRules(user, rules, window, deps)
    // What the eval worker runs for each first-pass notification: every rule but its source.
    for (const source of rules) {
      await evaluateAllRules(
        user,
        rules.filter((r) => r.id !== source.id),
        window,
        deps,
      )
    }
    expect(notifier).not.toHaveBeenCalled()

    for (const output of ['holosync', 'vocal_training']) {
      expect(await getActivities(user, output, window.start, window.end)).toHaveLength(1)
    }
  })
})
