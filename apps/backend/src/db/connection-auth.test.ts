/**
 * Password authentication against a user's database.
 *
 * These cover the two properties `/login`, the OAuth password grant and the
 * OwnTracks endpoint all depend on: a password is always actually checked, and
 * a database that cannot be reached is distinguishable from a wrong password.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const instances: {
    config: Record<string, unknown>
    connect: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }[] = []
  const pools: { config: Record<string, unknown> }[] = []
  return { connectImpl: { fn: async () => {} }, instances, pools }
})

vi.mock('pg', () => ({
  Client: class {
    config: Record<string, unknown>
    connect = vi.fn(() => mocks.connectImpl.fn())
    end = vi.fn(async () => {})
    query = vi.fn(async () => ({ rowCount: 0, rows: [] }))

    constructor(config: Record<string, unknown>) {
      this.config = config
      mocks.instances.push(this as never)
    }
  },
  Pool: class {
    config: Record<string, unknown>
    connect = vi.fn()
    end = vi.fn(async () => {})
    on = vi.fn()

    constructor(config: Record<string, unknown>) {
      this.config = config
      mocks.pools.push(this)
    }
  },
}))

const { _setDbForUser, getDbForUser, isInvalidPasswordError, loginToUserDb } = await import('./connection.ts')

const pgError = (code: string, message = 'pg failure') => Object.assign(new Error(message), { code })

beforeEach(() => {
  mocks.instances.length = 0
  mocks.pools.length = 0
  mocks.connectImpl.fn = async () => {}
})

describe('isInvalidPasswordError', () => {
  test('true for invalid_password (28P01)', () => {
    expect(isInvalidPasswordError(pgError('28P01', 'password authentication failed'))).toBe(true)
  })

  test('true for invalid_authorization_specification (28000)', () => {
    expect(isInvalidPasswordError(pgError('28000'))).toBe(true)
  })

  test('false for a connection failure — that is our fault, not a bad password', () => {
    expect(isInvalidPasswordError(pgError('08006', 'connection terminated'))).toBe(false)
    expect(isInvalidPasswordError(pgError('57P03', 'the database system is starting up'))).toBe(false)
  })

  test('false for a connect timeout, which carries no SQLSTATE', () => {
    expect(isInvalidPasswordError(new Error('timeout expired'))).toBe(false)
  })

  test('true for a codeless driver error that names an authentication failure', () => {
    expect(isInvalidPasswordError(new Error('password authentication failed for user "bob"'))).toBe(true)
  })

  test('false for a non-Error', () => {
    expect(isInvalidPasswordError('28P01')).toBe(false)
  })
})

describe('loginToUserDb', () => {
  test("connects as the user's own role, with a connect timeout", async () => {
    await loginToUserDb('alice', 'secret')

    expect(mocks.instances).toHaveLength(1)
    expect(mocks.instances[0]!.config).toMatchObject({
      database: 'aurboda_alice',
      password: 'secret',
      user: 'alice',
    })
    // Without this, an unreachable server hangs the caller until the TCP
    // timeout instead of failing in seconds.
    expect(mocks.instances[0]!.config.connectionTimeoutMillis).toBeGreaterThan(0)
  })

  test('verifies the password even when a client is already cached', async () => {
    // A warm cache is the normal state: getDbForUser fills it as the service
    // role on any token-authenticated request. It must not stand in for a
    // password check.
    const cached = { connect: vi.fn(), end: vi.fn(), query: vi.fn() }
    _setDbForUser('bob', cached as never)

    await loginToUserDb('bob', 'secret')

    expect(mocks.instances).toHaveLength(1)
    expect(mocks.instances[0]!.connect).toHaveBeenCalled()
  })

  test('rejects a wrong password even when a client is already cached', async () => {
    const cached = { connect: vi.fn(), end: vi.fn(), query: vi.fn() }
    _setDbForUser('carol', cached as never)
    mocks.connectImpl.fn = async () => {
      throw pgError('28P01', 'password authentication failed for user "carol"')
    }

    await expect(loginToUserDb('carol', 'wrong')).rejects.toThrow('password authentication failed')
  })

  test('closes the throwaway client and keeps the cached one', async () => {
    const cached = { connect: vi.fn(), end: vi.fn(), query: vi.fn() }
    _setDbForUser('dave', cached as never)

    await loginToUserDb('dave', 'secret')

    expect(mocks.instances[0]!.end).toHaveBeenCalled()
    expect(cached.end).not.toHaveBeenCalled()
    await expect(getDbForUser('dave')).resolves.toBe(cached)
  })

  test('closes the password client even when nothing was cached, and never hands it out', async () => {
    await loginToUserDb('erin', 'secret')

    const passwordClient = mocks.instances[0]!
    expect(passwordClient.end).toHaveBeenCalled()
    const db = await getDbForUser('erin')
    expect(db).not.toBe(passwordClient)
    expect(mocks.pools).toHaveLength(1)
    // The pool connects as the service role: no user password in its config.
    expect(mocks.pools[0]!.config).toMatchObject({ database: 'aurboda_erin' })
    expect(mocks.pools[0]!.config.password).toBeUndefined()
    expect(mocks.pools[0]!.config.user).toBeUndefined()
  })

  test('caches nothing when the connection fails', async () => {
    mocks.connectImpl.fn = async () => {
      throw pgError('28P01')
    }

    await expect(loginToUserDb('frank', 'wrong')).rejects.toThrow()

    expect(mocks.instances[0]!.end).toHaveBeenCalled()
    await getDbForUser('frank')
    expect(mocks.pools).toHaveLength(1)
    expect(mocks.instances).toHaveLength(1)
  })
})

describe('getDbForUser', () => {
  test('concurrent first calls share one pool', async () => {
    const [a, b, c] = await Promise.all([getDbForUser('gina'), getDbForUser('gina'), getDbForUser('gina')])

    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(mocks.pools).toHaveLength(1)
  })

  test('sizes the pool and bounds the wait for a connection', async () => {
    await getDbForUser('hank')

    expect(mocks.pools[0]!.config).toMatchObject({ database: 'aurboda_hank', max: 5 })
    expect(mocks.pools[0]!.config.connectionTimeoutMillis).toBeGreaterThan(0)
    expect(mocks.pools[0]!.config.idleTimeoutMillis).toBeGreaterThan(0)
  })
})
