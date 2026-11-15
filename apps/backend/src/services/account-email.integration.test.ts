import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import format from 'pg-format'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from 'vitest'

import { isInvalidPasswordError, loginToUserDb, setUserPassword, userDbName } from '../db/index.ts'
import { createRolePool, type UserDb, withTransaction } from '../db/pool.ts'
import { type CentralDb, createCentralDb } from './central-db.ts'

const CONTAINER_TIMEOUT = 120_000

const adminUri = () => {
  const uri = inject('pgAdminUri')
  if (!uri) {
    throw new Error('Test database not available: this run started without the integration global setup')
  }
  return new URL(uri)
}

const databaseUri = (database: string) => {
  const uri = adminUri()
  uri.pathname = `/${database}`
  return uri.toString()
}

const suffix = randomBytes(4).toString('hex')
const centralDatabase = `central_mail_${suffix}`
let admin: Client
let centralPool: UserDb
let centralDb: CentralDb

beforeAll(async () => {
  admin = new Client({ connectionString: adminUri().toString() })
  await admin.connect()
  await admin.query(format('CREATE DATABASE %I', centralDatabase))
  centralPool = createRolePool({ connectionString: databaseUri(centralDatabase), max: 3 })
  centralDb = createCentralDb({
    getClient: async () => centralPool,
    withTransaction: (fn) => withTransaction(centralPool, fn),
  })
  // Twice, as every start runs it: the table, index and columns are created once and kept.
  await centralDb.initializeCentralDb()
  await centralDb.initializeCentralDb()
}, CONTAINER_TIMEOUT)

afterAll(async () => {
  await centralPool?.end()
  await admin?.query(format('DROP DATABASE IF EXISTS %I WITH (FORCE)', centralDatabase)).catch(() => {})
  await admin?.end()
})

beforeEach(async () => {
  await centralPool.query('TRUNCATE TABLE account_email_tokens, user_accounts')
})

const inAnHour = () => new Date(Date.now() + 3_600_000)

describe('user_accounts.email_verified_at', () => {
  test('a new or cleared address is unverified, the same one keeps its verification', async () => {
    await centralDb.ensureUserAccount('alice', { createdAt: new Date(), preExisting: false })
    expect(await centralDb.setUserEmail('alice', 'alice@example.com')).toMatchObject({
      email_verified_at: null,
    })

    expect(await centralDb.markEmailVerified('alice', 'alice@example.com')).toBe(true)
    const verified = await centralDb.getUserAccount('alice')
    expect(verified?.email_verified_at).toBeInstanceOf(Date)

    expect((await centralDb.setUserEmail('alice', 'alice@example.com'))?.email_verified_at).toEqual(
      verified?.email_verified_at,
    )
    expect((await centralDb.setUserEmail('alice', 'other@example.com'))?.email_verified_at).toBeNull()
    await centralDb.markEmailVerified('alice', 'other@example.com')
    expect((await centralDb.setUserEmail('alice', null))?.email_verified_at).toBeNull()
  })

  test('markEmailVerified does nothing once the address changed', async () => {
    await centralDb.ensureUserAccount('alice', { createdAt: new Date(), preExisting: false })
    await centralDb.setUserEmail('alice', 'new@example.com')
    expect(await centralDb.markEmailVerified('alice', 'old@example.com')).toBe(false)
    expect((await centralDb.getUserAccount('alice'))?.email_verified_at).toBeNull()
  })

  test('listAccountsByVerifiedEmail matches verified addresses without case, up to the limit', async () => {
    for (const [name, email, verify] of [
      ['alice', 'Alice@Example.com', true],
      ['bob', 'alice@example.com', true],
      ['carol', 'alice@example.com', false],
      ['dave', 'alice@example.com', true],
    ] as const) {
      await centralDb.ensureUserAccount(name, { createdAt: new Date(), preExisting: false })
      await centralDb.setUserEmail(name, email)
      if (verify) await centralDb.markEmailVerified(name, email)
    }
    const found = await centralDb.listAccountsByVerifiedEmail('ALICE@example.com', 2)
    expect(found.map((a) => a.username)).toEqual(['alice', 'bob'])
  })
})

describe('account_email_tokens', () => {
  const issue = (token_hash: string, purpose: 'verify' | 'reset' = 'reset', expires_at = inAnHour()) =>
    centralDb.issueAccountEmailToken({
      email: 'alice@example.com',
      expires_at,
      purpose,
      token_hash,
      username: 'alice',
    })

  test('a token is consumed once, for its own purpose only', async () => {
    await issue('h1')
    expect(await centralDb.consumeAccountEmailToken('h1', 'verify')).toBeNull()
    expect(await centralDb.consumeAccountEmailToken('h1', 'reset')).toEqual({
      email: 'alice@example.com',
      username: 'alice',
    })
    expect(await centralDb.consumeAccountEmailToken('h1', 'reset')).toBeNull()
    expect(await centralDb.consumeAccountEmailToken('unknown', 'reset')).toBeNull()
  })

  test('an expired token is refused and pruned at the next issue', async () => {
    await issue('old', 'verify', new Date(Date.now() - 1000))
    expect(await centralDb.consumeAccountEmailToken('old', 'verify')).toBeNull()
    await centralDb.issueAccountEmailToken({
      email: 'bob@example.com',
      expires_at: inAnHour(),
      purpose: 'reset',
      token_hash: 'bob1',
      username: 'bob',
    })
    const rows = await centralPool.query('SELECT token_hash FROM account_email_tokens ORDER BY token_hash')
    expect(rows.rows.map((r) => r.token_hash)).toEqual(['bob1'])
  })

  test("issuing a token drops the user's earlier unused ones of that purpose only", async () => {
    await issue('v1', 'verify')
    await issue('r1', 'reset')
    await issue('r2', 'reset')
    expect(await centralDb.consumeAccountEmailToken('r1', 'reset')).toBeNull()
    expect(await centralDb.consumeAccountEmailToken('v1', 'verify')).not.toBeNull()
    expect(await centralDb.consumeAccountEmailToken('r2', 'reset')).not.toBeNull()
  })

  test('deleteAllCentralUserData removes the tokens', async () => {
    await issue('h1')
    expect((await centralDb.deleteAllCentralUserData('alice')).account_email_tokens).toBe(1)
  })
})

describe('setUserPassword', () => {
  const user = `pw_${suffix}`

  beforeAll(async () => {
    await admin.query(format('CREATE USER %I WITH ENCRYPTED PASSWORD %L', user, 'old password'))
    await admin.query(format('CREATE DATABASE %I OWNER %I', userDbName(user), user))
  })

  afterAll(async () => {
    await admin.query(format('DROP DATABASE IF EXISTS %I WITH (FORCE)', userDbName(user))).catch(() => {})
    await admin.query(format('DROP USER IF EXISTS %I', user)).catch(() => {})
  })

  /** `loginToUserDb` connects by the PG* environment, as the server does. */
  const withServerEnv = async <T>(fn: () => Promise<T>): Promise<T> => {
    const uri = adminUri()
    const saved = { PGHOST: process.env.PGHOST, PGPORT: process.env.PGPORT }
    process.env.PGHOST = uri.hostname
    process.env.PGPORT = uri.port
    try {
      return await fn()
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  }

  const loginError = (password: string) =>
    withServerEnv(() =>
      loginToUserDb(user, password).then(
        () => null,
        (error: unknown) => error,
      ),
    )

  test('after a reset, the new password signs in and the old one does not', async () => {
    expect(await loginError('old password')).toBeNull()
    await setUserPassword(admin, user, "new 'password'")
    expect(await loginError("new 'password'")).toBeNull()
    expect(isInvalidPasswordError(await loginError('old password'))).toBe(true)
  })

  test('refuses an empty password', async () => {
    await expect(setUserPassword(admin, user, '')).rejects.toThrow('must not be empty')
  })
})
