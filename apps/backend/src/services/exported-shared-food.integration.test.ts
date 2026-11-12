import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'pg'
import format from 'pg-format'
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest'

import { _setDbForUser, initializeSchema, userDbName } from '../db/index.ts'
import { createRolePool, type UserDb } from '../db/pool.ts'
import { backfillMealFoodItemNames } from './backfill-meal-food-item-names.ts'
import {
  createSharedFoodItemsApi,
  CREATE_SHARED_FOOD_ITEMS_INDEXES,
  CREATE_SHARED_FOOD_ITEMS_TABLE,
  type SharedFoodItemsApi,
} from './central-food-items.ts'
import { type PgConnection, streamUserDump } from './export-dump.ts'
import {
  exportedSharedFoodTrailer,
  loadReferencedSharedFoodItems,
  reconcileExportedSharedFoodItems,
} from './exported-shared-food.ts'
import { resolveFoodItemDisplay } from './food-items.ts'
import { getMeal } from './meals.ts'

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

const suffix = randomBytes(4).toString('hex')
const pools: UserDb[] = []
const clients: Client[] = []
const users: string[] = []
const centralDatabases: string[] = []

const createUser = async (user: string): Promise<UserDb> => {
  users.push(user)
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
  pools.push(pool)
  _setDbForUser(user, pool)
  await initializeSchema(user)
  return pool
}

const createCentral = async (name: string): Promise<SharedFoodItemsApi> => {
  const database = `central_${name}_${suffix}`
  centralDatabases.push(database)
  await withClient(adminUri().toString(), (admin) => admin.query(format('CREATE DATABASE %I', database)))
  const client = new Client({ connectionString: databaseUri(database) })
  await client.connect()
  clients.push(client)
  await client.query(CREATE_SHARED_FOOD_ITEMS_TABLE)
  for (const statement of CREATE_SHARED_FOOD_ITEMS_INDEXES) await client.query(statement)
  return createSharedFoodItemsApi(async () => client)
}

/** docs/data-export.md, "Restore", as `export-dump.integration.test.ts` runs it. */
const restoreInto = async (target: string, dumpPath: string): Promise<UserDb> => {
  await createUser(target)
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
  const restore = `(echo 'SET ROLE "${target}";'; gunzip -c "$DUMP" | grep -v -e '^COMMENT ON EXTENSION' -e '^SET transaction_timeout') | psql -v ON_ERROR_STOP=1 --quiet "$TARGET_URI"`
  execFileSync('bash', ['-c', restore], {
    env: { ...process.env, DUMP: dumpPath, TARGET_URI: databaseUri(database) },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const restored = createRolePool({ connectionString: databaseUri(database), max: 2 }, target)
  pools.push(restored)
  _setDbForUser(target, restored)
  return restored
}

const tableExists = async (db: UserDb) =>
  (await db.query(`SELECT to_regclass('public.exported_shared_food_items') IS NOT NULL AS present`)).rows[0]
    .present as boolean

const references = async (db: UserDb) => ({
  ingredient: (await db.query('SELECT ingredient_food_item_id AS id FROM food_item_ingredients')).rows[0].id,
  jsonb: (await db.query(`SELECT food_items->0->>'food_item_id' AS id FROM meals`)).rows[0].id,
  meal: (await db.query('SELECT food_item_id AS id FROM meal_food_items')).rows[0].id,
  override: (await db.query('SELECT shared_food_item_id AS id FROM shared_food_item_overrides')).rows.map(
    (row) => row.id,
  ),
  portion: (await db.query('SELECT food_item_id AS id FROM food_item_portions')).rows[0].id,
  reference: (
    await db.query(
      'SELECT reference_food_item_id AS id FROM food_items WHERE reference_food_item_id IS NOT NULL',
    )
  ).rows[0].id,
  sensitivity: (await db.query('SELECT food_item_id AS id FROM food_item_sensitivities')).rows[0].id,
})

describe('shared food items through export and restore', () => {
  const source = `sfood_src_${suffix}`
  let dir: string
  let dumpPath: string
  let central: SharedFoodItemsApi
  let sharedId: string
  let mealId: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aurboda-shared-food-'))
    dumpPath = join(dir, 'dump.sql.gz')
    central = await createCentral('src')
    const cheese = await central.upsertSharedFoodItem({
      calories: 350,
      default_quantity: 100,
      default_unit: 'g',
      icon: '🧀',
      name: "Hushållsost, Bob's",
      source: 'livsmedelsverket',
      source_id: '10',
    })
    sharedId = cheese.id

    const db = await createUser(source)
    mealId = (
      await db.query(
        `INSERT INTO meals (time, food_items) VALUES ('2026-11-01T08:00:00Z', $1) RETURNING id`,
        [JSON.stringify([{ food_item_id: sharedId, name: 'Cheese' }])],
      )
    ).rows[0].id
    await db.query(
      `INSERT INTO meal_food_items (meal_id, food_item_id, quantity, unit, calories) VALUES ($1, $2, 30, 'g', 105)`,
      [mealId, sharedId],
    )
    await db.query(
      `INSERT INTO food_item_portions (food_item_id, label_unit, base_equivalent) VALUES ($1, 'skiva', 10)`,
      [sharedId],
    )
    const flag = (await db.query(`INSERT INTO sensitivity_flags (name) VALUES ('dairy') RETURNING id`))
      .rows[0].id
    await db.query(
      'INSERT INTO food_item_sensitivities (food_item_id, sensitivity_flag_id) VALUES ($1, $2)',
      [sharedId, flag],
    )
    await db.query(
      `INSERT INTO shared_food_item_overrides (shared_food_item_id, icon, icon_overridden, default_log_quantity)
       VALUES ($1, '🥛', TRUE, 2)`,
      [sharedId],
    )
    const sandwich = (
      await db.query(
        `INSERT INTO food_items (name, name_lower, is_composite) VALUES ('Sandwich', 'sandwich', TRUE) RETURNING id`,
      )
    ).rows[0].id
    await db.query(
      `INSERT INTO food_item_ingredients (parent_food_item_id, ingredient_food_item_id, quantity, unit)
       VALUES ($1, $2, 20, 'g')`,
      [sandwich, sharedId],
    )
    await db.query(
      `INSERT INTO food_items (name, name_lower, reference_food_item_id) VALUES ('Farm cheese', 'farm cheese', $1)`,
      [sharedId],
    )

    const items = await loadReferencedSharedFoodItems(source, central)
    expect(items.map((item) => item.id)).toEqual([sharedId])
    await streamUserDump({
      conn: conn(),
      out: createWriteStream(dumpPath),
      trailer: exportedSharedFoodTrailer(items),
      user: source,
    })
  }, 120_000)

  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()))
    await Promise.all(clients.map((client) => client.end()))
    await withClient(adminUri().toString(), async (admin) => {
      for (const user of users) {
        await admin.query(format('DROP DATABASE IF EXISTS %I WITH (FORCE)', userDbName(user)))
        await admin.query(format('DROP USER IF EXISTS %I', user))
      }
      for (const database of centralDatabases) {
        await admin.query(format('DROP DATABASE IF EXISTS %I WITH (FORCE)', database))
      }
    }).catch(() => {})
    if (dir) await rm(dir, { force: true, recursive: true })
  })

  test('the restored database carries the referenced shared items in their own table', async () => {
    const db = await restoreInto(`sfood_peek_${suffix}`, dumpPath)
    const rows = (
      await db.query('SELECT id, name, source, source_id, calories, icon FROM exported_shared_food_items')
    ).rows
    expect(rows).toEqual([
      {
        calories: 350,
        icon: '🧀',
        id: sharedId,
        name: "Hushållsost, Bob's",
        source: 'livsmedelsverket',
        source_id: '10',
      },
    ])
  }, 120_000)

  test('without the item in the library, it becomes the user’s own item under the same id', async () => {
    const target = `sfood_copy_${suffix}`
    const db = await restoreInto(target, dumpPath)
    const emptyCentral = await createCentral('empty')

    expect(await reconcileExportedSharedFoodItems(target, { central: emptyCentral })).toEqual({
      copied: 1,
      kept: 0,
      matched: 0,
    })

    expect(await tableExists(db)).toBe(false)
    const own = (
      await db.query(
        `SELECT name, source, source_id, calories, icon, default_log_quantity FROM food_items WHERE id = $1`,
        [sharedId],
      )
    ).rows
    expect(own).toEqual([
      {
        calories: 350,
        default_log_quantity: 2,
        icon: '🥛',
        name: "Hushållsost, Bob's",
        source: 'livsmedelsverket',
        source_id: '10',
      },
    ])
    expect((await db.query('SELECT count(*)::int AS n FROM shared_food_item_overrides')).rows[0].n).toBe(0)
    expect(await references(db)).toMatchObject({
      ingredient: sharedId,
      jsonb: sharedId,
      meal: sharedId,
      portion: sharedId,
      reference: sharedId,
      sensitivity: sharedId,
    })

    const meal = await getMeal(target, mealId)
    expect(meal.data?.food_items?.[0]).toMatchObject({
      icon: '🥛',
      name: "Hushållsost, Bob's",
      sensitivities: ['dairy'],
    })

    expect(await backfillMealFoodItemNames(target, { centralDb: emptyCentral })).toEqual({
      skipped: false,
      updated: 1,
    })
    expect((await db.query('SELECT food_item_name, food_item_icon FROM meal_food_items')).rows).toEqual([
      { food_item_icon: '🥛', food_item_name: "Hushållsost, Bob's" },
    ])
    expect(await backfillMealFoodItemNames(target, { centralDb: emptyCentral })).toEqual({
      skipped: true,
      updated: 0,
    })

    expect(await reconcileExportedSharedFoodItems(target, { central: emptyCentral })).toBeNull()
  }, 120_000)

  test('with the same source and source id under another id, every reference is re-pointed', async () => {
    const target = `sfood_match_${suffix}`
    const db = await restoreInto(target, dumpPath)
    const otherCentral = await createCentral('other')
    const renamed = await otherCentral.upsertSharedFoodItem({
      calories: 351,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Hushållsost',
      source: 'livsmedelsverket',
      source_id: '10',
    })
    expect(renamed.id).not.toBe(sharedId)

    expect(await reconcileExportedSharedFoodItems(target, { central: otherCentral })).toEqual({
      copied: 0,
      kept: 0,
      matched: 1,
    })

    expect(await tableExists(db)).toBe(false)
    expect(await references(db)).toEqual({
      ingredient: renamed.id,
      jsonb: renamed.id,
      meal: renamed.id,
      override: [renamed.id],
      portion: renamed.id,
      reference: renamed.id,
      sensitivity: renamed.id,
    })
    expect((await db.query('SELECT count(*)::int AS n FROM food_items')).rows[0].n).toBe(2)
    const display = await resolveFoodItemDisplay(target, otherCentral, [renamed.id])
    expect(display.get(renamed.id)).toEqual({ icon: '🥛', name: 'Hushållsost' })
  }, 120_000)

  test('restored on a server whose library has the same id, nothing changes', async () => {
    const target = `sfood_same_${suffix}`
    const db = await restoreInto(target, dumpPath)

    expect(await reconcileExportedSharedFoodItems(target, { central })).toEqual({
      copied: 0,
      kept: 1,
      matched: 0,
    })

    expect(await tableExists(db)).toBe(false)
    expect(await references(db)).toEqual({
      ingredient: sharedId,
      jsonb: sharedId,
      meal: sharedId,
      override: [sharedId],
      portion: sharedId,
      reference: sharedId,
      sensitivity: sharedId,
    })
    expect((await db.query('SELECT count(*)::int AS n FROM food_items')).rows[0].n).toBe(2)
  }, 120_000)
})
