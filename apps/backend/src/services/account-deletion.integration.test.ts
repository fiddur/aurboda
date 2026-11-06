import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import format from 'pg-format'
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest'

import { _setDbForUser, dropUserDb, initializeSchema, listUserNames, userDbName } from '../db/index.ts'
import { createRolePool, type UserDb, withTransaction } from '../db/pool.ts'
import { createAccountDeleter } from './account-deletion.ts'
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

/** The steps `makeNewUserDb` takes, with the test server's superuser in place of the service role. */
const createUser = async (admin: Client, user: string): Promise<void> => {
  const database = userDbName(user)
  await admin.query(format('CREATE USER %I WITH ENCRYPTED PASSWORD %L', user, 'pw'))
  await admin.query(format('CREATE DATABASE %I OWNER %I', database, user))
  const setup = new Client({ connectionString: databaseUri(database) })
  await setup.connect()
  for (const extension of ['postgis', 'pg_trgm', 'unaccent']) {
    await setup.query(`CREATE EXTENSION IF NOT EXISTS ${extension}`)
  }
  await setup.end()
  _setDbForUser(user, createRolePool({ connectionString: databaseUri(database), max: 2 }, user))
  await initializeSchema(user)
}

describe('account deletion', () => {
  const suffix = randomBytes(4).toString('hex')
  const user = `del_${suffix}`
  const keeper = `keep_${suffix}`
  const centralDatabase = `central_${suffix}`
  let admin: Client
  let centralPool: UserDb
  let centralDb: CentralDb

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUri().toString() })
    await admin.connect()
    // Not the per-file test database: that one carries the per-user schema, whose
    // `oauth_tokens` is not the central table of the same name.
    await admin.query(format('CREATE DATABASE %I', centralDatabase))
    centralPool = createRolePool({ connectionString: databaseUri(centralDatabase), max: 3 })
    centralDb = createCentralDb({
      getClient: async () => centralPool,
      withTransaction: (fn) => withTransaction(centralPool, fn),
    })
    await centralDb.initializeCentralDb()

    await createUser(admin, user)
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await admin
      .query(format('DROP DATABASE IF EXISTS %I WITH (FORCE)', userDbName(user)))
      .then(() => admin.query(format('DROP USER IF EXISTS %I', user)))
      .catch(() => {})
    await centralPool.end()
    await admin.query(format('DROP DATABASE IF EXISTS %I WITH (FORCE)', centralDatabase)).catch(() => {})
    await admin.end()
  })

  test(
    'drops the database and role, removes every central row and reserves the name',
    async () => {
      await centralDb.addAdmin(keeper)
      await centralDb.addAdmin(user)
      await centralDb.ensureUserAccount(user, { createdAt: new Date(), preExisting: false })
      await centralDb.upsertUsageRows([
        {
          channel: 'web',
          count: 1,
          day: '2026-11-06',
          items: 1,
          kind: 'read',
          last_at: new Date('2026-11-06T10:00:00Z'),
          username: user,
        },
      ])
      await centralDb.createOAuthClient({
        client_id: `client_${suffix}`,
        client_name: 'Test client',
        redirect_uris: [],
        token_endpoint_auth_method: 'none',
      })
      await centralDb.saveOAuthToken({
        client_id: `client_${suffix}`,
        created_at: new Date(),
        expires_at: new Date(Date.now() + 3_600_000),
        parent_token: null,
        revoked: false,
        token: `aur_at_${suffix}`,
        token_type: 'access',
        username: user,
      })
      await centralDb.insertWebAuthnUserHandle(user, '11111111-1111-1111-1111-111111111111')
      await centralDb.upsertOuraUserMapping(`oura_${suffix}`, user)
      await centralDb.upsertStravaAthleteMapping(4242, user)
      const job = await centralDb.insertImportJob('livsmedelsverket', user)

      const deleted: string[] = []
      const deleteAccount = createAccountDeleter({
        announceDeletion: async () => {},
        centralDb,
        dropUserDb: (name) => dropUserDb(admin, name),
        integrations: [],
        listUsers: () => listUserNames(admin),
        log: { error: () => {}, info: () => {}, warn: () => {} },
        onDeleted: (name) => deleted.push(name),
      })

      expect(await deleteAccount(user, { actor: keeper, confirmUsername: user })).toEqual({ ok: true })
      expect(deleted).toEqual([user])

      const databases = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [userDbName(user)])
      expect(databases.rowCount).toBe(0)
      const roles = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user])
      expect(roles.rowCount).toBe(0)

      const client = centralPool
      for (const table of [
        'admins',
        'oauth_tokens',
        'oauth_authorization_codes',
        'webauthn_user_handles',
        'oura_user_mappings',
        'strava_athlete_mappings',
        'user_accounts',
        'user_usage_daily',
      ]) {
        const rows = await client.query(`SELECT 1 FROM ${table} WHERE username = $1`, [user])
        expect({ count: rows.rowCount, table }).toEqual({ count: 0, table })
      }
      expect((await centralDb.getImportJobById(job.id))?.started_by).toBeUndefined()
      expect(await centralDb.isAdmin(keeper)).toBe(true)

      expect(await centralDb.isUsernameDeleted(user)).toBe(true)
      expect(await centralDb.listDeletedUsernames()).toContain(user)
      const reservation = await client.query('SELECT deleted_by FROM deleted_usernames WHERE username = $1', [
        user,
      ])
      expect(reservation.rows[0].deleted_by).toBe(keeper)
    },
    CONTAINER_TIMEOUT,
  )
})
