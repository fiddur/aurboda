/**
 * The schema-migration gate (#1125).
 *
 * `migrateSchema` is ~130 statements including full-table rewrites, minutes on
 * a real database, so it is skipped when the user's database already records
 * this build's schema fingerprint. Two properties make that safe, and both are
 * covered here: the gate really does skip, and the lazy repair path really does
 * ignore it — a statement that hit a schema error has proved the marker wrong.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = {
    /** Databases whose every statement throws, to stand for a broken user. */
    failDatabases: new Set<string>(),
    /** Throw on the first statement containing this, to fail a sweep midway. */
    failOn: null as string | null,
    /** Whether `schema_migrations` already holds this build's fingerprint. */
    fingerprintRecorded: false,
    queries: [] as { database: unknown; params?: unknown[]; sql: string }[],
  }
  return { state }
})

vi.mock('pg', () => {
  const runQuery = async (database: unknown, sql: string, params?: unknown[]) => {
    mocks.state.queries.push({ database, params, sql })

    if (mocks.state.failDatabases.has(String(database))) {
      throw new Error(`database ${String(database)} is broken`)
    }
    if (mocks.state.failOn && sql.includes(mocks.state.failOn)) {
      throw new Error('sweep failed midway')
    }
    if (sql.includes('FROM schema_migrations WHERE name = $1')) {
      return mocks.state.fingerprintRecorded
        ? { rowCount: 1, rows: [{ '?column?': 1 }] }
        : { rowCount: 0, rows: [] }
    }
    return { rowCount: 0, rows: [] }
  }

  return {
    Client: class {
      config: Record<string, unknown>
      connect = vi.fn(async () => {})
      end = vi.fn(async () => {})
      query = vi.fn(async (sql: string, params?: unknown[]) => runQuery(this.config.database, sql, params))

      constructor(config: Record<string, unknown>) {
        this.config = config
      }
    },
    Pool: class {
      config: Record<string, unknown>
      end = vi.fn(async () => {})
      on = vi.fn()
      connect = vi.fn(async () => ({
        query: async (sql: string, params?: unknown[]) => runQuery(this.config.database, sql, params),
        release: () => {},
      }))

      constructor(config: Record<string, unknown>) {
        this.config = config
      }
    },
  }
})

const { _runMigrationOnce, migrateAllUsers, migrateSchema, migrateSchemaIfNeeded } =
  await import('./connection.ts')
const { schemaFingerprint } = await import('../schema.ts')

/** Only the sweep probes information_schema, so this is "the sweep ran". */
const SWEEP_MARKER = 'FROM information_schema.tables WHERE table_catalog'
/** A statement from the middle of the sweep, to fail it after it has started. */
const MID_SWEEP = 'CREATE TABLE IF NOT EXISTS raw_records'

const sweepsFor = (database: string) =>
  mocks.state.queries.filter((q) => q.database === database && q.sql.includes(SWEEP_MARKER))

const recordedFingerprints = (database: string) =>
  mocks.state.queries
    .filter((q) => q.database === database && q.sql.includes('INSERT INTO schema_migrations'))
    .flatMap((q) => q.params ?? [])

/** Distinct per test: `getDbForUser` caches its pool per user, module-wide. */
let counter = 0
const freshUser = () => `user${(counter += 1)}`

beforeEach(() => {
  mocks.state.failDatabases = new Set()
  mocks.state.failOn = null
  mocks.state.fingerprintRecorded = false
  mocks.state.queries.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('migrateSchema', () => {
  test('skips the sweep when the database already records this fingerprint', async () => {
    mocks.state.fingerprintRecorded = true
    const user = freshUser()

    await migrateSchema(user)

    expect(sweepsFor(`aurboda_${user}`)).toEqual([])
    // It did look: the skip is a decision, not a missing code path.
    expect(
      mocks.state.queries.filter((q) => q.sql.includes('FROM schema_migrations WHERE name = $1')),
    ).not.toEqual([])
  })

  test('checks the marker against this build, not just any past migration', async () => {
    mocks.state.fingerprintRecorded = true
    const user = freshUser()

    await migrateSchema(user)

    const lookups = mocks.state.queries.filter((q) =>
      q.sql.includes('FROM schema_migrations WHERE name = $1'),
    )
    expect(lookups[0]?.params).toEqual([`schema@${schemaFingerprint()}`])
  })

  test('sweeps when the marker is absent, and records the fingerprint afterwards', async () => {
    const user = freshUser()

    await migrateSchema(user)

    expect(sweepsFor(`aurboda_${user}`)).toHaveLength(1)
    expect(recordedFingerprints(`aurboda_${user}`)).toEqual([`schema@${schemaFingerprint()}`])
  })

  test('records the fingerprint only after the sweep, never before it', async () => {
    const user = freshUser()

    await migrateSchema(user)

    const own = mocks.state.queries.filter((q) => q.database === `aurboda_${user}`)
    const sweptAt = own.findIndex((q) => q.sql.includes(SWEEP_MARKER))
    const recordedAt = own.findIndex((q) => q.sql.includes('INSERT INTO schema_migrations'))
    expect(sweptAt).toBeGreaterThanOrEqual(0)
    expect(recordedAt).toBeGreaterThan(sweptAt)
  })

  test('forced, it sweeps even when the marker is present', async () => {
    // The safety net: a caller that saw a schema error knows the marker lies.
    mocks.state.fingerprintRecorded = true
    const user = freshUser()

    await migrateSchema(user, { force: true })

    expect(sweepsFor(`aurboda_${user}`)).toHaveLength(1)
  })

  test('a sweep that throws records nothing, so the next run retries it', async () => {
    mocks.state.failOn = MID_SWEEP
    const user = freshUser()

    await expect(migrateSchema(user)).rejects.toThrow('sweep failed midway')

    expect(sweepsFor(`aurboda_${user}`)).toHaveLength(1)
    expect(recordedFingerprints(`aurboda_${user}`)).toEqual([])
  })
})

describe('_runMigrationOnce', () => {
  test('uses the injected migrate function when one is given', async () => {
    const migrate = vi.fn(async () => {})
    const user = freshUser()

    await _runMigrationOnce(user, migrate)

    expect(migrate).toHaveBeenCalledWith(user)
  })

  test('a forced caller does not inherit an in-flight gated run that would skip', async () => {
    // The hazard the fingerprint introduces: a gated sweep is in flight and
    // about to skip, then a schema error arrives. Joining that promise would
    // repair nothing and the retried statement would fail anyway.
    mocks.state.fingerprintRecorded = true
    const user = freshUser()

    const gated = migrateSchemaIfNeeded(user)
    const forced = _runMigrationOnce(user)
    expect(forced).not.toBe(gated)
    await Promise.all([gated, forced])

    expect(sweepsFor(`aurboda_${user}`)).toHaveLength(1)
  })

  test('a forced caller joins an in-flight forced run', async () => {
    const user = freshUser()

    const first = _runMigrationOnce(user)
    const second = _runMigrationOnce(user)
    expect(first).toBe(second)
    await Promise.all([first, second])

    expect(sweepsFor(`aurboda_${user}`)).toHaveLength(1)
  })

  test('its default forces, ignoring a marker that says the schema is current', async () => {
    // This is the lazy repair path: `query` reaches it after a schema error,
    // which is proof that the recorded fingerprint cannot be trusted.
    mocks.state.fingerprintRecorded = true
    const user = freshUser()

    await _runMigrationOnce(user)

    expect(sweepsFor(`aurboda_${user}`)).toHaveLength(1)
  })
})

describe('migrateSchemaIfNeeded', () => {
  test('respects the marker — the gated entry point', async () => {
    mocks.state.fingerprintRecorded = true
    const user = freshUser()

    await migrateSchemaIfNeeded(user)

    expect(sweepsFor(`aurboda_${user}`)).toEqual([])
  })

  test('coalesces concurrent callers into one sweep', async () => {
    const user = freshUser()

    const first = migrateSchemaIfNeeded(user)
    const second = migrateSchemaIfNeeded(user)
    expect(first).toBe(second)
    await Promise.all([first, second])

    expect(sweepsFor(`aurboda_${user}`)).toHaveLength(1)
  })
})

describe('migrateAllUsers', () => {
  const adminClient = (users: string[]) =>
    ({
      query: async () => ({
        rowCount: users.length,
        rows: users.map((u) => ({ datname: `aurboda_${u}` })),
      }),
    }) as never

  test('sweeps every user and reports the count', async () => {
    const users = [freshUser(), freshUser()]

    await expect(migrateAllUsers(adminClient(users))).resolves.toEqual({
      failed: 0,
      migrated: 2,
      skipped: 0,
    })

    for (const user of users) expect(sweepsFor(`aurboda_${user}`)).toHaveLength(1)
  })

  test('reports users that were already current as skipped, not migrated', async () => {
    mocks.state.fingerprintRecorded = true
    const users = [freshUser(), freshUser()]

    await expect(migrateAllUsers(adminClient(users))).resolves.toEqual({
      failed: 0,
      migrated: 0,
      skipped: 2,
    })

    for (const user of users) expect(sweepsFor(`aurboda_${user}`)).toEqual([])
  })

  test('carries on past a broken database and reports it as failed', async () => {
    const [broken, healthy] = [freshUser(), freshUser()]
    mocks.state.failDatabases = new Set([`aurboda_${broken}`])

    await expect(migrateAllUsers(adminClient([broken, healthy]))).resolves.toEqual({
      failed: 1,
      migrated: 1,
      skipped: 0,
    })

    // The user after the broken one was still visited.
    expect(sweepsFor(`aurboda_${healthy}`)).toHaveLength(1)
    expect(console.error).toHaveBeenCalled()
  })
})
