import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getDeductionRules, getUserSettings } from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  defaultRunCategoryRuleDeps,
  defaultRunCategoryRules,
  ensureDefaultRunCategoryRules,
} from './run-category-rules.ts'

const CONTAINER_TIMEOUT = 120_000

describe('seeding the default run-category rules', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('concurrent seeds create the rules once', async () => {
    const user = getTestUser()
    const results = await Promise.all([
      ensureDefaultRunCategoryRules(user, 'running'),
      ensureDefaultRunCategoryRules(user, 'running'),
    ])

    expect(results.map((r) => r.seeded).sort()).toEqual([0, defaultRunCategoryRules.length])
    expect(await getDeductionRules(user)).toHaveLength(defaultRunCategoryRules.length)
    expect((await ensureDefaultRunCategoryRules(user, 'running')).seeded).toBe(0)
  })

  test('a walk seeds nothing', async () => {
    const user = getTestUser()
    expect(await ensureDefaultRunCategoryRules(user, 'walking')).toEqual({ seeded: 0 })
    expect(await getDeductionRules(user)).toHaveLength(0)
    expect((await getUserSettings(user))?.run_category_rules_seeded).toBeUndefined()
  })

  test('a failed insert rolls the claim back, so a later seed creates them all', async () => {
    const user = getTestUser()
    let inserted = 0
    const failing = {
      ...defaultRunCategoryRuleDeps,
      insertDeductionRule: async (
        ...args: Parameters<typeof defaultRunCategoryRuleDeps.insertDeductionRule>
      ) => {
        if (++inserted === 3) throw new Error('boom')
        return defaultRunCategoryRuleDeps.insertDeductionRule(...args)
      },
      reportFailure: () => {},
    }

    expect(await ensureDefaultRunCategoryRules(user, 'running', failing)).toEqual({ seeded: 0 })
    expect(await getDeductionRules(user)).toHaveLength(0)
    expect((await getUserSettings(user))?.run_category_rules_seeded).toBeUndefined()

    expect((await ensureDefaultRunCategoryRules(user, 'running')).seeded).toBe(defaultRunCategoryRules.length)
    expect(await getDeductionRules(user)).toHaveLength(defaultRunCategoryRules.length)
  })
})
