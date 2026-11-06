import { describe, expect, test } from 'vitest'

import { type AccountDeletionDeps, createAccountDeleter } from './account-deletion.ts'

const silent = { error: () => {}, info: () => {}, warn: () => {} }

const setup = (
  overrides: {
    admins?: string[]
    users?: string[]
    announce?: () => Promise<void>
    drop?: () => Promise<void>
    stravaDisconnect?: () => Promise<void>
  } = {},
) => {
  const calls: string[] = []
  const admins = overrides.admins ?? ['root1', 'root2']
  const users = overrides.users ?? ['alice', 'root1', 'root2']
  const step =
    (name: string, fn?: () => Promise<void>) =>
    async (...args: unknown[]) => {
      calls.push(`${name}(${args.join(',')})`)
      await fn?.()
    }
  const deps: AccountDeletionDeps = {
    announceDeletion: step('announce', overrides.announce),
    centralDb: {
      deleteAllCentralUserData: async (username) => {
        calls.push(`central(${username})`)
        return {}
      },
      deleteOuraUserMappingsByUsername: async (username) => {
        calls.push(`ouraMapping(${username})`)
        return 1
      },
      deleteStravaAthleteMappingByUsername: async (username) => {
        calls.push(`stravaMapping(${username})`)
        return true
      },
      getAdminCount: async () => admins.length,
      isAdmin: async (username) => admins.includes(username),
      reserveDeletedUsername: async (username, by) => {
        calls.push(`reserve(${username},${by})`)
        return true
      },
    },
    dropUserDb: step('drop', overrides.drop),
    integrations: [
      { disconnect: step('oura'), name: 'Oura' },
      { disconnect: step('strava', overrides.stravaDisconnect), name: 'Strava' },
    ],
    listUsers: async () => users,
    log: silent,
    onDeleted: (username) => calls.push(`deleted(${username})`),
  }
  return { calls, deleteAccount: createAccountDeleter(deps) }
}

describe('createAccountDeleter', () => {
  test('runs every step in order: reserve, federate, revoke, drop, then central rows', async () => {
    const { calls, deleteAccount } = setup()

    expect(await deleteAccount('alice', { actor: 'alice', confirmUsername: 'alice' })).toEqual({ ok: true })
    expect(calls).toEqual([
      'reserve(alice,alice)',
      'announce(alice)',
      'oura(alice)',
      'strava(alice)',
      'ouraMapping(alice)',
      'stravaMapping(alice)',
      'deleted(alice)',
      'drop(alice)',
      'central(alice)',
    ])
  })

  test('records the admin as the one who deleted', async () => {
    const { calls, deleteAccount } = setup()
    await deleteAccount('alice', { actor: 'root1', confirmUsername: 'alice' })
    expect(calls[0]).toBe('reserve(alice,root1)')
  })

  test('refuses a confirmation that does not match, touching nothing', async () => {
    const { calls, deleteAccount } = setup()
    const result = await deleteAccount('alice', { actor: 'alice', confirmUsername: 'alicee' })
    expect(result).toMatchObject({ error: 'confirmation_mismatch', ok: false })
    expect(calls).toEqual([])
  })

  test('refuses the last admin', async () => {
    const { calls, deleteAccount } = setup({ admins: ['root1'] })
    const result = await deleteAccount('root1', { actor: 'root1', confirmUsername: 'root1' })
    expect(result).toMatchObject({ error: 'last_admin', ok: false })
    expect(calls).toEqual([])
  })

  test('deletes an admin while another admin remains', async () => {
    const { deleteAccount } = setup()
    expect(await deleteAccount('root1', { actor: 'root2', confirmUsername: 'root1' })).toEqual({ ok: true })
  })

  test('answers not_found for an unknown user without reserving the name', async () => {
    const { calls, deleteAccount } = setup()
    const result = await deleteAccount('mallory', { actor: 'root1', confirmUsername: 'mallory' })
    expect(result).toMatchObject({ error: 'not_found', ok: false })
    expect(calls).toEqual([])
  })

  test('carries on when the federation Delete or an integration revoke fails', async () => {
    const { calls, deleteAccount } = setup({
      announce: async () => {
        throw new Error('remote down')
      },
      stravaDisconnect: async () => {
        throw new Error('strava 500')
      },
    })
    expect(await deleteAccount('alice', { actor: 'alice', confirmUsername: 'alice' })).toEqual({ ok: true })
    expect(calls).toContain('drop(alice)')
    expect(calls.at(-1)).toBe('central(alice)')
  })

  test('returns the error when the database cannot be dropped, keeping central rows for a retry', async () => {
    const { calls, deleteAccount } = setup({
      drop: async () => {
        throw new Error('database is being accessed by other users')
      },
    })
    const result = await deleteAccount('alice', { actor: 'alice', confirmUsername: 'alice' })
    expect(result).toMatchObject({ error: 'drop_failed', ok: false })
    expect(calls).toContain('reserve(alice,alice)')
    expect(calls).not.toContain('central(alice)')
  })
})
