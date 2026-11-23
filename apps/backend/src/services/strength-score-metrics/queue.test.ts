import { describe, expect, it, vi } from 'vitest'

vi.mock('../audit-log.ts', () => ({ auditError: vi.fn() }))

import type { Job } from '../pg-boss.ts'

import { auditError } from '../audit-log.ts'
import { runStrengthScoreSweep, type StrengthScoreRefreshJobData, usersOfJobs } from './queue.ts'

const job = (user: string) => ({ data: { user } }) as Job<StrengthScoreRefreshJobData>

describe('usersOfJobs', () => {
  it('gives each user once, in order of first job', () => {
    expect(usersOfJobs([job('bob'), job('alice'), job('bob'), job('carol'), job('alice')])).toEqual([
      'bob',
      'alice',
      'carol',
    ])
  })
})

describe('runStrengthScoreSweep', () => {
  it('refreshes every user, carrying on past a failing one and skipping read-only accounts', async () => {
    const refresh = vi.fn(async (user: string) => {
      if (user === 'bob') throw new Error('boom')
    })
    const visited = await runStrengthScoreSweep({
      isReadOnly: async (user) => user === 'dave',
      listUsers: async () => ['alice', 'bob', 'carol', 'dave'],
      refresh,
    })

    expect(visited).toBe(4)
    expect(refresh.mock.calls.map(([user]) => user)).toEqual(['alice', 'bob', 'carol'])
    expect(auditError).toHaveBeenCalledWith('bob', 'data', 'Strength score metrics refresh failed', {
      error: 'Error: boom',
    })
  })
})
