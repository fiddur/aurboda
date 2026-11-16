import { describe, expect, test, vi } from 'vitest'

import {
  type AccountSignupDeps,
  createAccount,
  isUsernameTaken,
  signupGateRefusal,
} from './account-signup.ts'

const setup = ({
  mode = 'open',
  roles = [] as string[],
  deleted = [] as string[],
  admins = 1,
}: { mode?: string; roles?: string[]; deleted?: string[]; admins?: number } = {}) => {
  const deps = {
    centralDb: {
      addAdmin: vi.fn(async () => {}),
      ensureUserAccount: vi.fn(async () => true),
      getAdminCount: vi.fn(async () => admins),
      getServerSetting: vi.fn(async () => null),
      getSignupMode: vi.fn(async () => mode),
      isUsernameDeleted: vi.fn(async (u: string) => deleted.includes(u)),
    },
    createToken: (u: string) => `token-${u}`,
    invitationAuth: {
      validateInvitationToken: (t: string) =>
        t === 'good' ? { valid: true } : t === 'old' ? { expired: true, valid: false } : { valid: false },
    },
    log: { error: vi.fn(), info: vi.fn() },
    makeNewUserDb: vi.fn(async () => {}),
    notifyAdmins: vi.fn(),
    roleExists: async (u: string) => roles.includes(u),
    signupProfile: { setDisplayName: vi.fn(async () => {}), setEmail: vi.fn(async () => {}) },
  } as unknown as AccountSignupDeps
  return deps
}

describe('createAccount', () => {
  test('creates the role, the account row and the profile, and notifies the admins', async () => {
    const deps = setup()
    expect(await createAccount(deps, { display_name: 'Ada', password: 'pw', username: 'ada' })).toEqual({
      is_admin: false,
      ok: true,
      token: 'token-ada',
      username: 'ada',
    })
    expect(deps.makeNewUserDb).toHaveBeenCalledWith('ada', 'pw')
    expect(deps.centralDb.ensureUserAccount).toHaveBeenCalled()
    expect(deps.signupProfile.setDisplayName).toHaveBeenCalledWith('ada', 'Ada')
    expect(deps.notifyAdmins).toHaveBeenCalledWith('ada')
    expect(deps.centralDb.addAdmin).not.toHaveBeenCalled()
  })

  test('the first user becomes admin', async () => {
    const deps = setup({ admins: 0 })
    expect(await createAccount(deps, { password: 'pw', username: 'ada' })).toMatchObject({ is_admin: true })
    expect(deps.centralDb.addAdmin).toHaveBeenCalledWith('ada')
  })

  test.each([
    [{ mode: 'closed' }, {}, 403, 'Signup is currently closed'],
    [{ mode: 'invite_only' }, {}, 403, 'An invitation is required to sign up'],
    [{ mode: 'invite_only' }, { invitation: 'old' }, 403, 'Invitation has expired'],
    [{ mode: 'invite_only' }, { invitation: 'bad' }, 403, 'Invalid invitation'],
    [{}, { username: 'Ada' }, 400, expect.stringContaining('Username must be')],
    [{}, { username: 'admin' }, 400, 'This username is reserved'],
    [{ roles: ['ada'] }, {}, 409, 'Username already exists'],
    [{ deleted: ['ada'] }, {}, 409, 'Username already exists'],
  ])('refuses %o %o with %i', async (options, input, status, error) => {
    const deps = setup(options)
    expect(await createAccount(deps, { password: 'pw', username: 'ada', ...input })).toEqual({
      error,
      ok: false,
      status,
    })
    expect(deps.makeNewUserDb).not.toHaveBeenCalled()
  })

  test('an invite-only server takes a valid invitation', async () => {
    const deps = setup({ mode: 'invite_only' })
    expect(await createAccount(deps, { invitation: 'good', password: 'pw', username: 'ada' })).toMatchObject({
      ok: true,
    })
  })

  test('a role created meanwhile is 409, any other failure throws', async () => {
    const deps = setup()
    vi.mocked(deps.makeNewUserDb).mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '42710' }))
    expect(await createAccount(deps, { password: 'pw', username: 'ada' })).toMatchObject({ status: 409 })
    vi.mocked(deps.makeNewUserDb).mockRejectedValueOnce(new Error('disk full'))
    await expect(createAccount(deps, { password: 'pw', username: 'ada' })).rejects.toThrow('disk full')
  })
})

describe('signupGateRefusal and isUsernameTaken', () => {
  test('an open server takes anyone', async () => {
    expect(await signupGateRefusal(setup(), undefined)).toBeNull()
  })

  test('a name is taken by a role or a deleted account', async () => {
    const deps = setup({ deleted: ['gone'], roles: ['ada'] })
    expect(await isUsernameTaken(deps, 'ada')).toBe(true)
    expect(await isUsernameTaken(deps, 'gone')).toBe(true)
    expect(await isUsernameTaken(deps, 'free')).toBe(false)
  })
})
