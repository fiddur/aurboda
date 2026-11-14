import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { activitiesTables } from '../schema/activities.ts'
import { catalogSchemaFor, strengthTrainingDataSchema } from '../schema/builtin-data-schemas.ts'
import { getCatalogActivityType, loadActivityTypeCatalog } from '../services/activity-type-catalog.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { deleteActivity, getActivityById, insertActivity } from './activities/index.ts'
import {
  adoptCatalogActivityType,
  deleteActivityTypeDefinition,
  ensureActivityType,
  expandActivityTypes,
  expandAncestorTypes,
  findActivityTypeForName,
  getActivityTypeDefinition,
  getDescendantTypes,
  insertActivityTypeDefinition,
  mergeActivityTypeDefinition,
  resolveOrCreateActivityType,
  updateActivityTypeDefinition,
} from './activity-type-definitions.ts'
import { query } from './connection.ts'

const CONTAINER_TIMEOUT = 120_000

describe('Hierarchical activity types', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    // Seed test-specific custom types with hierarchy.
    // The built-in exercise subtypes are already seeded by initializeSchema.
  })

  describe('seed hierarchy', () => {
    test('exercise subtypes have parent_type = exercise', async () => {
      const user = getTestUser()
      const running = await getActivityTypeDefinition(user, 'running')
      expect(running?.parent_type).toBe('exercise')
      const yoga = await getActivityTypeDefinition(user, 'yoga')
      expect(yoga?.parent_type).toBe('exercise')
    })

    test('nap and rest have parent_type = sleep', async () => {
      const user = getTestUser()
      const nap = await getActivityTypeDefinition(user, 'nap')
      expect(nap?.parent_type).toBe('sleep')
      const rest = await getActivityTypeDefinition(user, 'rest')
      expect(rest?.parent_type).toBe('sleep')
    })

    test('root types have no parent_type', async () => {
      const user = getTestUser()
      const exercise = await getActivityTypeDefinition(user, 'exercise')
      expect(exercise?.parent_type).toBeUndefined()
      const sleep = await getActivityTypeDefinition(user, 'sleep')
      expect(sleep?.parent_type).toBeUndefined()
    })
  })

  describe('list data fields', () => {
    test('the built-in strength_training type carries the sets schema', async () => {
      const strength = await getActivityTypeDefinition(getTestUser(), 'strength_training')
      expect(strength?.data_schema).toEqual(strengthTrainingDataSchema)
    })

    test('a custom type with a list field reads back unchanged', async () => {
      const user = getTestUser()
      const data_schema = {
        fields: [
          { name: 'location', type: 'string' as const },
          {
            item_fields: [
              { name: 'exercise', required: true, type: 'string' as const },
              { name: 'side', enum_values: ['left', 'right'], type: 'string' as const },
              { name: 'reps', type: 'number' as const },
            ],
            label: 'Exercises',
            name: 'exercises',
            type: 'list' as const,
          },
        ],
      }
      await insertActivityTypeDefinition(user, {
        data_schema,
        display_category: 'exercise',
        display_name: 'Rehab',
        name: 'rehab_session',
      })
      const read = await getActivityTypeDefinition(user, 'rehab_session')
      expect(read?.data_schema).toEqual(data_schema)
      await deleteActivityTypeDefinition(user, 'rehab_session')
    })
  })

  describe('insertActivityTypeDefinition with parent_type', () => {
    test('creates a type with a valid parent', async () => {
      const user = getTestUser()
      const result = await insertActivityTypeDefinition(user, {
        name: 'hatha_yoga',
        display_name: 'Hatha Yoga',
        display_category: 'exercise',
        parent_type: 'yoga',
      })
      expect(result.parent_type).toBe('yoga')
    })

    test('rejects non-existent parent', async () => {
      const user = getTestUser()
      await expect(
        insertActivityTypeDefinition(user, {
          name: 'foo_bar',
          display_name: 'Foo',
          display_category: 'other',
          parent_type: 'nonexistent_parent',
        }),
      ).rejects.toThrow(/does not exist/)
    })

    test('rejects self as parent', async () => {
      const user = getTestUser()
      await expect(
        insertActivityTypeDefinition(user, {
          name: 'self_ref',
          display_name: 'Self',
          display_category: 'other',
          parent_type: 'self_ref',
        }),
      ).rejects.toThrow(/cannot reference the type itself/)
    })
  })

  describe('updateActivityTypeDefinition parent_type', () => {
    test('sets parent_type on existing type', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'my_exercise',
        display_name: 'My Exercise',
        display_category: 'exercise',
      })
      const updated = await updateActivityTypeDefinition(user, 'my_exercise', {
        parent_type: 'exercise',
      })
      expect(updated?.parent_type).toBe('exercise')
    })

    test('clears parent_type when set to null', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'temp_type',
        display_name: 'Temp',
        display_category: 'other',
        parent_type: 'exercise',
      })
      const cleared = await updateActivityTypeDefinition(user, 'temp_type', {
        parent_type: null,
      })
      expect(cleared?.parent_type).toBeUndefined()
    })

    test('rejects cycle', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'a_type',
        display_name: 'A',
        display_category: 'other',
      })
      await insertActivityTypeDefinition(user, {
        name: 'b_type',
        display_name: 'B',
        display_category: 'other',
        parent_type: 'a_type',
      })
      // Trying to set a_type.parent = b_type would create a cycle
      await expect(updateActivityTypeDefinition(user, 'a_type', { parent_type: 'b_type' })).rejects.toThrow(
        /cycle/,
      )
    })
  })

  describe('getDescendantTypes', () => {
    test('returns all descendants including grandchildren', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'cardio',
        display_name: 'Cardio',
        display_category: 'exercise',
        parent_type: 'exercise',
      })
      await insertActivityTypeDefinition(user, {
        name: 'sprint',
        display_name: 'Sprint',
        display_category: 'exercise',
        parent_type: 'cardio',
      })
      const descendants = await getDescendantTypes(user, 'cardio')
      expect(descendants).toContain('sprint')
      expect(descendants).not.toContain('cardio')
    })

    test('returns empty array for leaf type', async () => {
      const user = getTestUser()
      const descendants = await getDescendantTypes(user, 'running')
      expect(descendants).toEqual([])
    })

    test('exercise parent includes all builtin subtypes', async () => {
      const user = getTestUser()
      const descendants = await getDescendantTypes(user, 'exercise')
      expect(descendants).toContain('running')
      expect(descendants).toContain('yoga')
      expect(descendants.length).toBeGreaterThan(50)
    })
  })

  describe('expandActivityTypes', () => {
    test('includes self and all descendants', async () => {
      const user = getTestUser()
      const expanded = await expandActivityTypes(user, ['exercise'])
      expect(expanded).toContain('exercise')
      expect(expanded).toContain('running')
      expect(expanded).toContain('yoga')
    })

    test('leaf type expands to itself', async () => {
      const user = getTestUser()
      const expanded = await expandActivityTypes(user, ['running'])
      expect(expanded).toEqual(['running'])
    })

    test('multiple types combine without duplicates', async () => {
      const user = getTestUser()
      const expanded = await expandActivityTypes(user, ['sleep', 'meditation'])
      expect(expanded).toContain('sleep')
      expect(expanded).toContain('nap')
      expect(expanded).toContain('rest')
      expect(expanded).toContain('meditation')
      expect(new Set(expanded).size).toBe(expanded.length)
    })

    test('unknown type is returned as-is (no descendants to add)', async () => {
      const user = getTestUser()
      const expanded = await expandActivityTypes(user, ['nonexistent'])
      expect(expanded).toEqual(['nonexistent'])
    })
  })

  describe('expandAncestorTypes', () => {
    test('includes self and all ancestors of a 3-level chain', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'endurance',
        display_name: 'Endurance',
        display_category: 'exercise',
        parent_type: 'exercise',
      })
      await insertActivityTypeDefinition(user, {
        name: 'hill_sprint',
        display_name: 'Hill Sprint',
        display_category: 'exercise',
        parent_type: 'endurance',
      })
      const expanded = await expandAncestorTypes(user, ['hill_sprint'])
      expect(expanded.sort()).toEqual(['endurance', 'exercise', 'hill_sprint'])
    })

    test('type without a definition row is returned as-is', async () => {
      const user = getTestUser()
      const expanded = await expandAncestorTypes(user, ['nonexistent'])
      expect(expanded).toEqual(['nonexistent'])
    })

    test('empty input returns empty array', async () => {
      const user = getTestUser()
      expect(await expandAncestorTypes(user, [])).toEqual([])
    })

    test('deduplicates shared ancestors and repeated inputs', async () => {
      const user = getTestUser()
      const expanded = await expandAncestorTypes(user, ['running', 'yoga', 'running'])
      expect(expanded.sort()).toEqual(['exercise', 'running', 'yoga'])
    })
  })

  describe('deleteActivityTypeDefinition reparents children', () => {
    test('children of deleted type get parent of the deleted type', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'mid_level',
        display_name: 'Mid',
        display_category: 'exercise',
        parent_type: 'exercise',
      })
      await insertActivityTypeDefinition(user, {
        name: 'child_leaf',
        display_name: 'Child',
        display_category: 'exercise',
        parent_type: 'mid_level',
      })
      await deleteActivityTypeDefinition(user, 'mid_level')
      const child = await getActivityTypeDefinition(user, 'child_leaf')
      expect(child?.parent_type).toBe('exercise')
    })

    test('children become top-level if deleted type had no parent', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'top',
        display_name: 'Top',
        display_category: 'other',
      })
      await insertActivityTypeDefinition(user, {
        name: 'child',
        display_name: 'Child',
        display_category: 'other',
        parent_type: 'top',
      })
      await deleteActivityTypeDefinition(user, 'top')
      const child = await getActivityTypeDefinition(user, 'child')
      expect(child?.parent_type).toBeUndefined()
    })

    test('refusing to delete a builtin does not reparent its children', async () => {
      // Regression test: the delete guard must refuse builtin types *before*
      // reparenting, or the hierarchy gets silently flattened on a failed delete.
      const user = getTestUser()
      const deleted = await deleteActivityTypeDefinition(user, 'exercise')
      expect(deleted).toBe(false)
      const running = await getActivityTypeDefinition(user, 'running')
      expect(running?.parent_type).toBe('exercise')
    })
  })

  describe('mergeActivityTypeDefinition reparents children', () => {
    test('children of source become children of target', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'parent_a',
        display_name: 'A',
        display_category: 'other',
      })
      await insertActivityTypeDefinition(user, {
        name: 'parent_b',
        display_name: 'B',
        display_category: 'other',
      })
      await insertActivityTypeDefinition(user, {
        name: 'leaf_x',
        display_name: 'X',
        display_category: 'other',
        parent_type: 'parent_a',
      })
      await mergeActivityTypeDefinition(user, 'parent_a', 'parent_b')
      const leaf = await getActivityTypeDefinition(user, 'leaf_x')
      expect(leaf?.parent_type).toBe('parent_b')
    })
  })

  describe('mergeActivityTypeDefinition with soft-deleted activities (#1193)', () => {
    const seed = async (user: string, alias: string) => {
      await insertActivityTypeDefinition(user, {
        aliases: [alias],
        display_name: 'Yin yoga',
        display_category: 'exercise',
        name: 'yinyoga',
      })
      const live = await insertActivity(user, {
        activity_type: 'yinyoga',
        end_time: new Date('2025-02-18T19:00:00Z'),
        source: 'aurboda',
        start_time: new Date('2025-02-18T18:00:00Z'),
      })
      const gone = await insertActivity(user, {
        activity_type: 'yinyoga',
        end_time: new Date('2025-02-11T19:00:00Z'),
        source: 'aurboda',
        start_time: new Date('2025-02-11T18:00:00Z'),
      })
      await deleteActivity(user, gone)
      return { gone, live }
    }

    test('moves soft-deleted rows too, so the source definition can go', async () => {
      const user = getTestUser()
      const { gone, live } = await seed(user, 'yin')

      const result = await mergeActivityTypeDefinition(user, 'yinyoga', 'yoga')

      expect(result?.activities_reassigned).toBe(1)
      expect(result?.target.aliases).toContain('yin')
      expect(await getActivityTypeDefinition(user, 'yinyoga')).toBeNull()
      expect((await getActivityById(user, live))?.activity_type).toBe('yoga')
      const deleted = await getActivityById(user, gone, true)
      expect(deleted?.activity_type).toBe('yoga')
      expect(deleted?.deleted_at).toBeDefined()
    })

    test('moves routes of the source type too, so their FK does not block the delete', async () => {
      const user = getTestUser()
      await seed(user, 'yin')
      const line = `ST_GeomFromText('LINESTRING(18.07 59.3, 18.08 59.3)', 4326)`
      const inserted = await query(
        user,
        `INSERT INTO routes (name, activity_type, geom, buffer, length_m, start_pt, end_pt)
         VALUES ('Loop', 'yinyoga', ${line}, ST_Buffer(${line}::geography, 25)::geometry, 500,
                 ST_StartPoint(${line})::geography, ST_EndPoint(${line})::geography)
         RETURNING id`,
      )

      const result = await mergeActivityTypeDefinition(user, 'yinyoga', 'yoga')

      expect(result?.activities_reassigned).toBe(1)
      expect(await getActivityTypeDefinition(user, 'yinyoga')).toBeNull()
      const route = await query(user, `SELECT activity_type FROM routes WHERE id = $1`, [inserted.rows[0].id])
      expect(route.rows[0]?.activity_type).toBe('yoga')
    })

    test('a deleted source row that duplicates a target row is dropped rather than colliding', async () => {
      const user = getTestUser()
      await seed(user, 'yin')
      const start = new Date('2025-03-04T18:00:00Z')
      const kept = await insertActivity(user, {
        activity_type: 'yoga',
        end_time: new Date('2025-03-04T19:00:00Z'),
        source: 'aurboda',
        start_time: start,
      })
      const duplicate = await insertActivity(user, {
        activity_type: 'yinyoga',
        end_time: new Date('2025-03-04T19:00:00Z'),
        source: 'aurboda',
        start_time: start,
      })
      await deleteActivity(user, duplicate)

      const result = await mergeActivityTypeDefinition(user, 'yinyoga', 'yoga')

      expect(result?.activities_reassigned).toBe(1)
      expect(await getActivityTypeDefinition(user, 'yinyoga')).toBeNull()
      expect(await getActivityById(user, duplicate, true)).toBeNull()
      expect((await getActivityById(user, kept))?.activity_type).toBe('yoga')
    })

    test('a failure part-way leaves nothing merged', async () => {
      const user = getTestUser()
      const { live } = await seed(user, 'yin_rolled_back')
      await query(
        user,
        `CREATE FUNCTION block_type_delete() RETURNS trigger LANGUAGE plpgsql AS
           $$ BEGIN RAISE EXCEPTION 'blocked'; END $$`,
      )
      await query(
        user,
        `CREATE TRIGGER block_type_delete BEFORE DELETE ON activity_type_definitions
           FOR EACH ROW EXECUTE FUNCTION block_type_delete()`,
      )
      try {
        await expect(mergeActivityTypeDefinition(user, 'yinyoga', 'yoga')).rejects.toThrow('blocked')
      } finally {
        await query(user, `DROP TRIGGER block_type_delete ON activity_type_definitions`)
        await query(user, `DROP FUNCTION block_type_delete()`)
      }

      expect(await getActivityTypeDefinition(user, 'yinyoga')).not.toBeNull()
      expect((await getActivityTypeDefinition(user, 'yoga'))?.aliases).not.toContain('yin_rolled_back')
      expect((await getActivityById(user, live))?.activity_type).toBe('yinyoga')
    })
  })

  describe('mergeActivityTypeDefinition with setData', () => {
    beforeEach(async () => {
      await query(getTestUser(), `DELETE FROM activity_type_definitions WHERE name IN ('beer', 'drink')`)
    })

    const seedBeer = async (user: string) => {
      await insertActivityTypeDefinition(user, {
        display_category: 'other',
        display_name: 'Beer',
        name: 'beer',
      })
      await insertActivityTypeDefinition(user, {
        display_category: 'other',
        display_name: 'Drink',
        name: 'drink',
      })
      const at = (day: number) => ({
        activity_type: 'beer',
        source: 'aurboda' as const,
        start_time: new Date(`2025-04-${String(day).padStart(2, '0')}T18:00:00Z`),
      })
      return {
        absent: await insertActivity(user, { ...at(1), data: { drinks: 2 } }),
        both: await insertActivity(user, { ...at(2), data: { kind: 'lager' } }),
        noData: await insertActivity(user, at(3)),
        nullKind: await insertActivity(user, { ...at(4), data: { drinks: 1, kind: null } }),
      }
    }

    test('sets each key where it is absent or null and keeps existing values', async () => {
      const user = getTestUser()
      const ids = await seedBeer(user)

      const result = await mergeActivityTypeDefinition(user, 'beer', 'drink', { kind: 'beer', size: 'pint' })

      expect(result?.activities_reassigned).toBe(4)
      expect(result?.activities_data_set).toBe(4)
      expect((await getActivityById(user, ids.absent))?.data).toEqual({
        drinks: 2,
        kind: 'beer',
        size: 'pint',
      })
      expect((await getActivityById(user, ids.both))?.data).toEqual({ kind: 'lager', size: 'pint' })
      expect((await getActivityById(user, ids.noData))?.data).toEqual({ kind: 'beer', size: 'pint' })
      expect((await getActivityById(user, ids.nullKind))?.data).toEqual({
        drinks: 1,
        kind: 'beer',
        size: 'pint',
      })
    })

    test('does not count a row that already has every key', async () => {
      const user = getTestUser()
      const ids = await seedBeer(user)

      const result = await mergeActivityTypeDefinition(user, 'beer', 'drink', { kind: 'beer' })

      expect(result?.activities_reassigned).toBe(4)
      expect(result?.activities_data_set).toBe(3)
      expect((await getActivityById(user, ids.both))?.data).toEqual({ kind: 'lager' })
    })

    test('gives a soft-deleted row the value too without counting it', async () => {
      const user = getTestUser()
      const ids = await seedBeer(user)
      await deleteActivity(user, ids.absent)

      const result = await mergeActivityTypeDefinition(user, 'beer', 'drink', { kind: 'beer' })

      expect(result?.activities_reassigned).toBe(3)
      expect(result?.activities_data_set).toBe(2)
      const deleted = await getActivityById(user, ids.absent, true)
      expect(deleted?.activity_type).toBe('drink')
      expect(deleted?.data).toEqual({ drinks: 2, kind: 'beer' })
    })

    test('leaves data untouched without setData', async () => {
      const user = getTestUser()
      const ids = await seedBeer(user)

      const result = await mergeActivityTypeDefinition(user, 'beer', 'drink')

      expect(result?.activities_data_set).toBe(0)
      expect((await getActivityById(user, ids.absent))?.data).toEqual({ drinks: 2 })
      expect((await getActivityById(user, ids.nullKind))?.data).toEqual({ drinks: 1, kind: null })
    })
  })

  describe('rename with FK cascade', () => {
    test('renaming a parent updates children parent_type via CASCADE', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'old_parent',
        display_name: 'Old',
        display_category: 'other',
      })
      await insertActivityTypeDefinition(user, {
        name: 'a_child',
        display_name: 'Child',
        display_category: 'other',
        parent_type: 'old_parent',
      })
      await query(user, `UPDATE activity_type_definitions SET name = 'new_parent' WHERE name = 'old_parent'`)
      const child = await getActivityTypeDefinition(user, 'a_child')
      expect(child?.parent_type).toBe('new_parent')
    })
  })

  describe('the built-in activity type catalogue', () => {
    const catalog = loadActivityTypeCatalog()
    const countRows = async (name: string): Promise<number> =>
      (await query(getTestUser(), `SELECT 1 FROM activity_type_definitions WHERE name = $1`, [name])).rows
        .length

    beforeEach(async () => {
      await query(getTestUser(), `DELETE FROM activity_type_definitions WHERE is_builtin = false`)
    })

    describe('adoptCatalogActivityType', () => {
      test('creates a catalogue type with its definition', async () => {
        const sauna = getCatalogActivityType(catalog, 'sauna')!
        const adopted = await adoptCatalogActivityType(getTestUser(), 'sauna')
        expect(adopted).toMatchObject({
          color: sauna.color,
          data_schema: sauna.data_schema,
          display_category: sauna.display_category,
          display_name: sauna.display_name,
          icon: sauna.icon,
          is_builtin: false,
          name: 'sauna',
        })
        expect(adopted?.aliases).toContain('sauna')
        expect(adopted?.parent_type).toBeUndefined()
      })

      test('creates the catalogue parent of a sub-type first', async () => {
        const user = getTestUser()
        const headache = await adoptCatalogActivityType(user, 'headache')
        expect(headache?.parent_type).toBe('symptom')
        expect((await getActivityTypeDefinition(user, 'symptom'))?.display_name).toBe('Symptom')
      })

      test('returns an existing type unchanged', async () => {
        const user = getTestUser()
        const own = await insertActivityTypeDefinition(user, {
          display_category: 'other',
          display_name: 'My sauna',
          name: 'sauna',
        })
        expect(await adoptCatalogActivityType(user, 'sauna')).toEqual(own)
        expect(await getActivityTypeDefinition(user, 'sauna')).toEqual(own)
      })

      test("puts a sub-type under the user's own parent and leaves that parent alone", async () => {
        const user = getTestUser()
        const own = await insertActivityTypeDefinition(user, {
          display_category: 'other',
          display_name: 'My symptoms',
          name: 'symptom',
        })
        expect((await adoptCatalogActivityType(user, 'headache'))?.parent_type).toBe('symptom')
        expect(await getActivityTypeDefinition(user, 'symptom')).toEqual(own)
      })

      test('is null for a name outside the catalogue', async () => {
        expect(await adoptCatalogActivityType(getTestUser(), 'not_a_catalogue_type')).toBeNull()
        expect(await countRows('not_a_catalogue_type')).toBe(0)
      })

      test('is safe to repeat and to run in parallel', async () => {
        const user = getTestUser()
        await adoptCatalogActivityType(user, 'headache')
        await adoptCatalogActivityType(user, 'headache')
        const parallel = await Promise.all([
          adoptCatalogActivityType(user, 'nausea'),
          adoptCatalogActivityType(user, 'nausea'),
          adoptCatalogActivityType(user, 'nausea'),
        ])
        expect(parallel.map((d) => d?.name)).toEqual(['nausea', 'nausea', 'nausea'])
        expect(await countRows('headache')).toBe(1)
        expect(await countRows('nausea')).toBe(1)
        expect(await countRows('symptom')).toBe(1)
      })
    })

    describe('ensureActivityType', () => {
      test('is true for an existing type', async () => {
        expect(await ensureActivityType(getTestUser(), 'running')).toBe(true)
      })

      test('is true for a catalogue type and adopts it', async () => {
        expect(await ensureActivityType(getTestUser(), 'caffeine')).toBe(true)
        expect(await countRows('caffeine')).toBe(1)
      })

      test('is false for an unknown name', async () => {
        expect(await ensureActivityType(getTestUser(), 'not_a_catalogue_type')).toBe(false)
        expect(await countRows('not_a_catalogue_type')).toBe(0)
      })
    })

    describe('findActivityTypeForName', () => {
      test("finds the user's type by its snake-cased name", async () => {
        const user = getTestUser()
        await insertActivityTypeDefinition(user, {
          display_category: 'other',
          display_name: 'Morning walk',
          name: 'morning_walk',
        })
        expect(await findActivityTypeForName(user, 'Morning Walk')).toBe('morning_walk')
      })

      test('finds a type by alias', async () => {
        const user = getTestUser()
        await insertActivityTypeDefinition(user, {
          aliases: ['evening stroll'],
          display_category: 'other',
          display_name: 'Walk',
          name: 'walk_outdoors',
        })
        expect(await findActivityTypeForName(user, 'Evening Stroll')).toBe('walk_outdoors')
      })

      test('is null for a name the user has no type for, and creates nothing', async () => {
        const user = getTestUser()
        expect(await findActivityTypeForName(user, 'tag_generic_beer')).toBeNull()
        expect(await findActivityTypeForName(user, 'Sauna')).toBeNull()
        expect(await countRows('tag_generic_beer')).toBe(0)
        expect(await countRows('sauna')).toBe(0)
      })
    })

    describe('resolveOrCreateActivityType', () => {
      test('a tag named like a catalogue type adopts it', async () => {
        const user = getTestUser()
        expect(await resolveOrCreateActivityType(user, 'Sauna')).toBe('sauna')
        const sauna = await getActivityTypeDefinition(user, 'sauna')
        expect(sauna?.display_category).toBe('wellness')
        expect(sauna?.data_schema).toEqual(getCatalogActivityType(catalog, 'sauna')?.data_schema)
      })

      test('a tag named like a catalogue alias lands on the seeded type', async () => {
        expect(await resolveOrCreateActivityType(getTestUser(), 'Breathwork')).toBe('guided_breathing')
        expect(await countRows('breathwork')).toBe(0)
      })

      test("a user's own type of that name wins", async () => {
        const user = getTestUser()
        await insertActivityTypeDefinition(user, {
          display_category: 'other',
          display_name: 'Breathwork',
          name: 'breathwork',
        })
        expect(await resolveOrCreateActivityType(user, 'Breathwork')).toBe('breathwork')
      })

      test('an exercise import is never redirected to the catalogue', async () => {
        const user = getTestUser()
        expect(await resolveOrCreateActivityType(user, 'Sauna', 'exercise')).toBe('sauna')
        const sauna = await getActivityTypeDefinition(user, 'sauna')
        expect(sauna?.display_category).toBe('exercise')
        expect(sauna?.data_schema).toBeUndefined()
      })
    })

    describe('seeded built-ins shared with the catalogue', () => {
      const seed = activitiesTables.activity_type_definitions_seed

      test('meditation and guided_breathing carry the catalogue fields, and guided_breathing shows as Breathwork', async () => {
        const user = getTestUser()
        const meditation = await getActivityTypeDefinition(user, 'meditation')
        const breathing = await getActivityTypeDefinition(user, 'guided_breathing')
        expect(meditation?.data_schema).toEqual(catalogSchemaFor('meditation'))
        expect(breathing?.data_schema).toEqual(catalogSchemaFor('guided_breathing'))
        expect(breathing?.display_name).toBe('Breathwork')
        expect(breathing?.parent_type).toBe('exercise')
        expect(breathing?.display_category).toBe('exercise')
      })

      test('a schema the user set is kept when the seed runs again', async () => {
        const user = getTestUser()
        const edited = { fields: [{ name: 'mantra', type: 'string' as const }] }
        await updateActivityTypeDefinition(user, 'meditation', { data_schema: edited })
        await updateActivityTypeDefinition(user, 'guided_breathing', { display_name: 'Pranayama' })
        try {
          await query(user, seed)
          expect((await getActivityTypeDefinition(user, 'meditation'))?.data_schema).toEqual(edited)
          expect((await getActivityTypeDefinition(user, 'guided_breathing'))?.display_name).toBe('Pranayama')
        } finally {
          await updateActivityTypeDefinition(user, 'meditation', {
            data_schema: catalogSchemaFor('meditation'),
          })
          await updateActivityTypeDefinition(user, 'guided_breathing', { display_name: 'Breathwork' })
        }
      })
    })
  })
})
