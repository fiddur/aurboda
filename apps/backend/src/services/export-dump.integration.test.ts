import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'pg'
import format from 'pg-format'
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest'

import { _setDbForUser, initializeSchema, migrateSchemaIfNeeded, userDbName } from '../db/index.ts'
import { createRolePool, type UserDb } from '../db/pool.ts'
import { createDumpExporter, type PgConnection, streamUserDump } from './export-dump.ts'

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

const withClient = async <T>(uri: string, fn: (client: Client) => Promise<T>): Promise<T> => {
  const client = new Client({ connectionString: uri })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

const conn = (): PgConnection => {
  const uri = adminUri()
  return {
    host: uri.hostname,
    password: decodeURIComponent(uri.password),
    port: uri.port,
    user: decodeURIComponent(uri.username),
  }
}

/** The steps `makeNewUserDb` takes, with the test server's superuser in place of the service role. */
const createUser = async (user: string): Promise<UserDb> => {
  const database = userDbName(user)
  await withClient(adminUri().toString(), async (admin) => {
    await admin.query(format('CREATE USER %I WITH ENCRYPTED PASSWORD %L', user, 'pw'))
    await admin.query(format('CREATE DATABASE %I OWNER %I', database, user))
  })
  await withClient(databaseUri(database), async (db) => {
    await db.query('CREATE EXTENSION IF NOT EXISTS postgis')
    await db.query('CREATE EXTENSION IF NOT EXISTS pg_trgm')
    await db.query('CREATE EXTENSION IF NOT EXISTS unaccent')
  })
  const pool = createRolePool({ connectionString: databaseUri(database), max: 2 }, user)
  _setDbForUser(user, pool)
  await initializeSchema(user)
  return pool
}

const counts = async (db: UserDb) =>
  Object.fromEntries(
    await Promise.all(
      ['time_series', 'activities', 'locations', 'activity_type_definitions'].map(async (table) => [
        table,
        Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n),
      ]),
    ),
  )

describe('database export', () => {
  const suffix = randomBytes(4).toString('hex')
  const source = `export_src_${suffix}`
  const target = `export_dst_${suffix}`
  let dir: string
  let dumpPath: string
  const pools: UserDb[] = []

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aurboda-export-'))
    dumpPath = join(dir, 'dump.sql.gz')

    const db = await createUser(source)
    pools.push(db)
    const activityType = (await db.query('SELECT name FROM activity_type_definitions ORDER BY name LIMIT 1'))
      .rows[0].name as string
    await db.query(
      `INSERT INTO time_series (time, metric, value, unit, source)
       VALUES ('2026-11-01T08:00:00Z', 'heart_rate', 61, 'bpm', 'manual'),
              ('2026-11-01T08:01:00Z', 'heart_rate', 63, 'bpm', 'manual')`,
    )
    await db.query(
      `INSERT INTO activities (source, activity_type, start_time, end_time, title)
       VALUES ('manual', $1, '2026-11-01T09:00:00Z', '2026-11-01T10:00:00Z', 'Morning')`,
      [activityType],
    )
    await db.query(
      `INSERT INTO locations (source, time, location)
       VALUES ('owntracks', '2026-11-01T09:30:00Z', ST_SetSRID(ST_MakePoint(18.07, 59.33), 4326)::geography)`,
    )
  }, 120_000)

  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()))
    await withClient(adminUri().toString(), async (admin) => {
      for (const user of [source, target]) {
        await admin.query(format('DROP DATABASE IF EXISTS %I WITH (FORCE)', userDbName(user)))
        await admin.query(format('DROP USER IF EXISTS %I', user))
      }
    }).catch(() => {})
    if (dir) await rm(dir, { force: true, recursive: true })
  })

  test('the real pg_dump passes the version check against the server', async () => {
    expect(await createDumpExporter({ conn: conn() }).check(source)).toEqual({ ok: true })
  })

  test('dumps with the real pg_dump and restores with the documented steps', async () => {
    const result = await streamUserDump({ conn: conn(), out: createWriteStream(dumpPath), user: source })
    expect(result.bytes).toBeGreaterThan(0)

    // docs/data-export.md, "Restore": sign up as the user (here: createUser), then recreate
    // the database empty with its extensions, then feed the dump to psql as the user.
    await createUser(target).then((pool) => pool.end())
    const database = userDbName(target)
    await withClient(adminUri().toString(), async (admin) => {
      await admin.query(format('DROP DATABASE %I WITH (FORCE)', database))
      await admin.query(format('CREATE DATABASE %I OWNER %I', database, target))
    })
    await withClient(databaseUri(database), async (db) => {
      await db.query('CREATE EXTENSION postgis')
      await db.query('CREATE EXTENSION pg_trgm')
      await db.query('CREATE EXTENSION unaccent')
    })

    const restore = `(echo 'SET ROLE "${target}";'; gunzip -c "$DUMP" | grep -v '^COMMENT ON EXTENSION') | psql -v ON_ERROR_STOP=1 --quiet "$TARGET_URI"`
    execFileSync('bash', ['-c', restore], {
      env: { ...process.env, DUMP: dumpPath, TARGET_URI: databaseUri(database) },
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    const restored = createRolePool({ connectionString: databaseUri(database), max: 2 }, target)
    pools.push(restored)
    _setDbForUser(target, restored)

    expect(await counts(restored)).toEqual(await counts(pools[0]))
    expect(await counts(restored)).toMatchObject({ activities: 1, locations: 1, time_series: 2 })

    const owners = await restored.query<{ tableowner: string }>(
      `SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'`,
    )
    expect(owners.rows.map((row) => row.tableowner)).toEqual([target])

    await expect(migrateSchemaIfNeeded(target)).resolves.toBeUndefined()
  }, 120_000)
})
