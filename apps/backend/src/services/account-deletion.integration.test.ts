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
  const halfDeleted = `half_${suffix}`
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

  const makeDeleter = (deleted: string[] = []) =>
    createAccountDeleter({
      announceDeletion: async () => {},
      centralDb,
      dropUserDb: (name) => dropUserDb(admin, name),
      integrations: [],
      listUsers: () => listUserNames(admin),
      log: { error: () => {}, info: () => {}, warn: () => {} },
      onDeleted: (name) => deleted.push(name),
    })

  afterAll(async () => {
    for (const name of [user, halfDeleted]) {
      await admin
        .query(format('DROP DATABASE IF EXISTS %I WITH (FORCE)', userDbName(name)))
        .then(() => admin.query(format('DROP USER IF EXISTS %I', name)))
        .catch(() => {})
    }
    await centralPool.end()
    await admin.query(format('DROP DATABASE IF EXISTS %I WITH (FORCE)', centralDatabase)).catch(() => {})
    await admin.end()
  })

  test(
    'drops the database and role, removes every central row and the blog setting naming it, and reserves the name',
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
      await centralDb.setServerSetting('official_feed', {
        remote_authors: [],
        tags: ['qs'],
        users: [user, keeper],
      })
      const tagPost = (n: number, localUser: string | null) => ({
        actor_uri: `https://aurboda.test/users/${localUser ?? 'remote'}`,
        announce_uris: localUser == null ? ['https://tags.test/announce/1'] : [],
        avatar_url: null,
        content: '<p>#aurboda</p>',
        display_name: null,
        handle: null,
        images: [],
        local_user: localUser,
        note_uri: `https://aurboda.test/notes/${suffix}/${n}`,
        published_at: new Date(),
        tags: ['aurboda'],
        url: null,
      })
      await centralDb.upsertPublicTagPost(tagPost(1, user))
      await centralDb.upsertPublicTagPost(tagPost(2, keeper))
      await centralDb.upsertPublicTagPost(tagPost(3, null))

      const deleted: string[] = []
      const deleteAccount = makeDeleter(deleted)

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
      const tagPosts = await client.query<{ local_user: string | null }>(
        'SELECT local_user FROM public_tag_posts WHERE note_uri LIKE $1 ORDER BY note_uri',
        [`https://aurboda.test/notes/${suffix}/%`],
      )
      expect(tagPosts.rows.map((r) => r.local_user)).toEqual([keeper, null])
      expect((await centralDb.getImportJobById(job.id))?.started_by).toBeUndefined()
      expect(await centralDb.isAdmin(keeper)).toBe(true)
      expect(await centralDb.getServerSetting('official_feed')).toEqual({
        remote_authors: [],
        tags: ['qs'],
        users: [keeper],
      })

      expect(await centralDb.isUsernameDeleted(user)).toBe(true)
      expect(await centralDb.listDeletedUsernames()).toContain(user)
      const reservation = await client.query('SELECT deleted_by FROM deleted_usernames WHERE username = $1', [
        user,
      ])
      expect(reservation.rows[0].deleted_by).toBe(keeper)
    },
    CONTAINER_TIMEOUT,
  )

  test(
    'finishes a deletion that dropped the database but left the role and central rows',
    async () => {
      await centralDb.addAdmin(keeper)
      await centralDb.addAdmin(halfDeleted)
      await centralDb.ensureUserAccount(halfDeleted, { createdAt: new Date(), preExisting: false })
      await centralDb.insertWebAuthnUserHandle(halfDeleted, '22222222-2222-2222-2222-222222222222')
      await centralDb.reserveDeletedUsername(halfDeleted, keeper)
      await admin.query(format('CREATE USER %I', halfDeleted))

      const deleteAccount = makeDeleter()
      expect(await deleteAccount(halfDeleted, { actor: keeper, confirmUsername: halfDeleted })).toEqual({
        ok: true,
      })

      const roles = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [halfDeleted])
      expect(roles.rowCount).toBe(0)
      for (const table of ['admins', 'user_accounts', 'webauthn_user_handles']) {
        const rows = await centralPool.query(`SELECT 1 FROM ${table} WHERE username = $1`, [halfDeleted])
        expect({ count: rows.rowCount, table }).toEqual({ count: 0, table })
      }
      expect(await centralDb.isUsernameDeleted(halfDeleted)).toBe(true)

      const unknown = `nobody_${suffix}`
      expect(await deleteAccount(unknown, { actor: keeper, confirmUsername: unknown })).toMatchObject({
        error: 'not_found',
        ok: false,
      })
    },
    CONTAINER_TIMEOUT,
  )
})
