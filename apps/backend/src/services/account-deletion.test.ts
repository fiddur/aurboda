import { describe, expect, test } from 'vitest'

import { type AccountDeletionDeps, createAccountDeleter } from './account-deletion.ts'

const silent = { error: () => {}, info: () => {}, warn: () => {} }

const setup = (
  overrides: {
    admins?: string[]
    users?: string[]
    reserved?: string[]
    announce?: () => Promise<void>
    drop?: () => Promise<void>
    central?: () => Promise<void>
    stravaDisconnect?: () => Promise<void>
    blogUsername?: string
    officialFeed?: { tags: string[]; users: string[] }
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
        await overrides.central?.()
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
      getAdmins: async () => admins,
      getServerSetting: (async (key: string) =>
        (key === 'official_feed' ? overrides.officialFeed : overrides.blogUsername) ??
        null) as AccountDeletionDeps['centralDb']['getServerSetting'],
      isUsernameDeleted: async (username) => (overrides.reserved ?? []).includes(username),
      reserveDeletedUsername: async (username, by) => {
        calls.push(`reserve(${username},${by})`)
        return true
      },
      setServerSetting: async (key, value) => {
        calls.push(`setting(${key},${typeof value === 'string' ? value : JSON.stringify(value)})`)
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
  test('runs every step in order: federate, revoke, reserve, drop, then central rows', async () => {
    const { calls, deleteAccount } = setup()

    expect(await deleteAccount('alice', { actor: 'alice', confirmUsername: 'alice' })).toEqual({ ok: true })
    expect(calls).toEqual([
      'announce(alice)',
      'oura(alice)',
      'strava(alice)',
      'ouraMapping(alice)',
      'stravaMapping(alice)',
      'reserve(alice,alice)',
      'deleted(alice)',
      'drop(alice)',
      'central(alice)',
    ])
  })

  test('takes the deleted user off the official feed, keeping the rest of it', async () => {
    const { calls, deleteAccount } = setup({ officialFeed: { tags: ['qs'], users: ['alice', 'root1'] } })
    expect(await deleteAccount('alice', { actor: 'root1', confirmUsername: 'alice' })).toEqual({ ok: true })
    expect(calls.slice(-3)).toEqual([
      'central(alice)',
      'setting(official_feed,{"remote_authors":[],"tags":["qs"],"users":["root1"]})',
      'setting(blog_username,)',
    ])
  })

  test('takes a legacy blog user off, turning the feed off', async () => {
    const { calls, deleteAccount } = setup({ blogUsername: 'alice' })
    expect(await deleteAccount('alice', { actor: 'root1', confirmUsername: 'alice' })).toEqual({ ok: true })
    expect(calls.slice(-2)).toEqual([
      'setting(official_feed,{"remote_authors":[],"tags":[],"users":[]})',
      'setting(blog_username,)',
    ])
  })

  test('leaves the official feed alone when it does not list the user', async () => {
    const { calls, deleteAccount } = setup({ blogUsername: 'root1' })
    expect(await deleteAccount('alice', { actor: 'alice', confirmUsername: 'alice' })).toEqual({ ok: true })
    expect(calls.some((call) => call.startsWith('setting('))).toBe(false)
  })

  test('takes the user off the official feed when finishing an unfinished deletion', async () => {
    const { calls, deleteAccount } = setup({
      officialFeed: { tags: [], users: ['ghost'] },
      reserved: ['ghost'],
    })
    expect(await deleteAccount('ghost', { actor: 'root1', confirmUsername: 'ghost' })).toEqual({ ok: true })
    expect(calls).toEqual([
      'deleted(ghost)',
      'drop(ghost)',
      'central(ghost)',
      'setting(official_feed,{"remote_authors":[],"tags":[],"users":[]})',
      'setting(blog_username,)',
    ])
  })

  test('records the admin as the one who deleted', async () => {
    const { calls, deleteAccount } = setup()
    await deleteAccount('alice', { actor: 'root1', confirmUsername: 'alice' })
    expect(calls).toContain('reserve(alice,root1)')
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

  test('refuses the last admin even when a stale admin row of a dropped user remains', async () => {
    const { calls, deleteAccount } = setup({ admins: ['root1', 'ghost'], reserved: ['ghost'] })
    const result = await deleteAccount('root1', { actor: 'root1', confirmUsername: 'root1' })
    expect(result).toMatchObject({ error: 'last_admin', ok: false })
    expect(calls).toEqual([])
  })

  test('finishes a deletion that dropped the database and then failed, without the steps that need it', async () => {
    const { calls, deleteAccount } = setup({ admins: ['root1', 'ghost'], reserved: ['ghost'] })
    expect(await deleteAccount('ghost', { actor: 'root1', confirmUsername: 'ghost' })).toEqual({ ok: true })
    expect(calls).toEqual(['deleted(ghost)', 'drop(ghost)', 'central(ghost)'])
  })

  test('reports a failed drop while finishing an unfinished deletion', async () => {
    const { calls, deleteAccount } = setup({
      drop: async () => {
        throw new Error('role is still referenced')
      },
      reserved: ['ghost'],
    })
    const result = await deleteAccount('ghost', { actor: 'root1', confirmUsername: 'ghost' })
    expect(result).toMatchObject({ error: 'drop_failed', ok: false })
    expect(calls).not.toContain('central(ghost)')
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

  test('still succeeds when the central rows cannot be removed after the drop', async () => {
    const { deleteAccount } = setup({
      central: async () => {
        throw new Error('central db down')
      },
    })
    expect(await deleteAccount('alice', { actor: 'alice', confirmUsername: 'alice' })).toEqual({ ok: true })
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
