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

describe('runDueReminders with check-ins', () => {
  test('runs the check-in step for every user after the reminders', async () => {
    const calls: string[] = []
    await runDueReminders({
      listUsers: async () => ['alice', 'bob'],
      raiseDue: async (user) => calls.push(`reminders:${user}`),
      raiseDueCheckIns: async (user) => calls.push(`check-ins:${user}`),
    })
    expect(calls).toEqual(['reminders:alice', 'check-ins:alice', 'reminders:bob', 'check-ins:bob'])
  })

  test('a failing step is reported with its name and stops neither the other step nor the other users', async () => {
    const calls: string[] = []
    const errors: [string, unknown, string][] = []
    const boom = new Error('bad schedule')
    await runDueReminders({
      listUsers: async () => ['alice', 'bob'],
      onUserError: (user, error, step) => errors.push([user, error, step]),
      raiseDue: async (user) => {
        if (user === 'alice') throw boom
        calls.push(`reminders:${user}`)
      },
      raiseDueCheckIns: async (user) => {
        if (user === 'bob') throw boom
        calls.push(`check-ins:${user}`)
      },
    })
    expect(calls).toEqual(['check-ins:alice', 'reminders:bob'])
    expect(errors).toEqual([
      ['alice', boom, 'Reminder'],
      ['bob', boom, 'Check-in'],
    ])
  })
})
