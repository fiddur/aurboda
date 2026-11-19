import { describe, expect, test, vi } from 'vitest'

import { removeRuleActivities, type RemoveRuleActivitiesDeps } from './deduction-rule-activities.ts'

const makeDeps = (deleted: Awaited<ReturnType<RemoveRuleActivitiesDeps['deleteRuleActivities']>>) => ({
  deleteRuleActivities: vi.fn(async () => deleted),
  markWorkoutHoursDirty: vi.fn(async () => undefined),
})

describe('removeRuleActivities', () => {
  test('marks the training load hours from the earliest deleted start of each type and answers the count', async () => {
    const earliest_by_type = [
      { activity_type: 'running', start_time: new Date('2026-06-01T08:00:00Z') },
      { activity_type: 'sauna', start_time: new Date('2026-06-02T18:00:00Z') },
    ]
    const deps = makeDeps({ count: 3, earliest_by_type })

    expect(await removeRuleActivities('alice', 'rule-1', deps)).toBe(3)
    expect(deps.deleteRuleActivities).toHaveBeenCalledExactlyOnceWith('alice', 'rule-1')
    expect(deps.markWorkoutHoursDirty).toHaveBeenCalledExactlyOnceWith('alice', earliest_by_type)
  })

  test('marks nothing when the rule had no activities', async () => {
    const deps = makeDeps({ count: 0, earliest_by_type: [] })

    expect(await removeRuleActivities('alice', 'rule-1', deps)).toBe(0)
    expect(deps.markWorkoutHoursDirty).not.toHaveBeenCalled()
  })
})
