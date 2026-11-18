import { describe, expect, test } from 'vitest'

import { runDueReminders } from './reminder-scheduler.ts'

describe('runDueReminders', () => {
  test('visits every user', async () => {
    const visited: string[] = []
    const count = await runDueReminders({
      listUsers: async () => ['alice', 'bob'],
      raiseDue: async (user) => visited.push(user),
    })
    expect(count).toBe(2)
    expect(visited).toEqual(['alice', 'bob'])
  })

  test('one failing user does not stop the rest, and is reported', async () => {
    const visited: string[] = []
    const errors: [string, unknown][] = []
    const boom = new Error('db gone')
    await runDueReminders({
      listUsers: async () => ['alice', 'bob', 'carol'],
      onUserError: (user, error) => errors.push([user, error]),
      raiseDue: async (user) => {
        if (user === 'bob') throw boom
        visited.push(user)
      },
    })
    expect(visited).toEqual(['alice', 'carol'])
    expect(errors).toEqual([['bob', boom]])
  })
})
