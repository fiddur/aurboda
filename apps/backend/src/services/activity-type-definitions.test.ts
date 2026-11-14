import type { ActivityTypeDefinition, StoredActivityTypeCatalog } from '@aurboda/api-spec'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import {
  addActivityTypeDefinition,
  addCatalogFieldsToActivityType,
  deleteActivityTypeDefinition,
  listActivityTypeCatalog,
  listActivityTypeDefinitions,
  mergeActivityType,
  renameActivityTypeDefinition,
  updateActivityTypeDefinition,
} from './activity-type-definitions.ts'

vi.mock('../db', () => ({
  adoptCatalogActivityType: vi.fn(),
  deleteActivityTypeDefinition: vi.fn(),
  ensureActivityType: vi.fn(),
  getActivityTypeDefinition: vi.fn(),
  getActivityTypeDefinitions: vi.fn(),
  insertActivityTypeDefinition: vi.fn(),
  mergeActivityTypeDefinition: vi.fn(),
  renameActivityTypeDefinition: vi.fn(),
  updateActivityTypeDefinition: vi.fn(),
}))

const user = 'testuser'

describe('listActivityTypeDefinitions', () => {
  beforeEach(() => vi.clearAllMocks())

  test('returns all definitions from db', async () => {
    const defs = [
      {
        color: '#3b82f6',
        display_category: 'sleep_rest' as const,
        display_name: 'Sleep',
        is_builtin: true,
        name: 'sleep',
        show_on_timeline: true,
      },
      {
        color: '#ef4444',
        display_category: 'wellness' as const,
        display_name: 'Sauna',
        is_builtin: false,
        name: 'sauna',
        show_on_timeline: true,
      },
    ]
    vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue(defs)

    const result = await listActivityTypeDefinitions(user)
    expect(result).toEqual(defs)
    expect(db.getActivityTypeDefinitions).toHaveBeenCalledWith(user)
  })
})

describe('addActivityTypeDefinition', () => {
  beforeEach(() => vi.clearAllMocks())

  test('creates a custom activity type', async () => {
    vi.mocked(db.getActivityTypeDefinition).mockResolvedValue(null)
    const created = {
      color: '#ef4444',
      display_category: 'wellness' as const,
      display_name: 'Sauna',
      is_builtin: false,
      name: 'sauna',
      show_on_timeline: true,
    }
    vi.mocked(db.insertActivityTypeDefinition).mockResolvedValue(created)

    const result = await addActivityTypeDefinition(user, {
      color: '#ef4444',
      display_category: 'wellness',
      display_name: 'Sauna',
      name: 'sauna',
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual(created)
  })

  test('rejects built-in type names', async () => {
    const result = await addActivityTypeDefinition(user, {
      display_category: 'sleep_rest',
      display_name: 'Sleep',
      name: 'sleep',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('built-in')
    expect(db.insertActivityTypeDefinition).not.toHaveBeenCalled()
  })

  test('rejects duplicate names', async () => {
    vi.mocked(db.getActivityTypeDefinition).mockResolvedValue({
      color: '#ef4444',
      display_category: 'wellness' as const,
      display_name: 'Sauna',
      is_builtin: false,
      name: 'sauna',
      show_on_timeline: true,
    })

    const result = await addActivityTypeDefinition(user, {
      display_category: 'wellness',
      display_name: 'Sauna',
      name: 'sauna',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('already exists')
  })
})

describe('addActivityTypeDefinition with the built-in catalogue', () => {
  const catalog: StoredActivityTypeCatalog = {
    entries: [
      {
        aliases: ['hot room'],
        color: '#f97316',
        data_schema: { fields: [{ name: 'rounds', type: 'number', min: 0 }] },
        display_category: 'wellness',
        display_name: 'Sauna',
        group: 'recovery',
        icon: '🧖',
        name: 'sauna',
        same_as: {},
      },
      {
        aliases: [],
        color: '#dc2626',
        display_category: 'health',
        display_name: 'Symptom',
        group: 'health',
        icon: '🩺',
        name: 'symptom',
        same_as: {},
      },
      {
        aliases: [],
        color: '#dc2626',
        data_schema: { fields: [{ max: 10, min: 0, name: 'severity', type: 'number' }] },
        display_category: 'health',
        display_name: 'Headache',
        group: 'symptoms',
        icon: '🤕',
        name: 'headache',
        parent_type: 'symptom',
        same_as: {},
      },
    ],
    groups: [
      { key: 'recovery', name: 'Recovery' },
      { key: 'health', name: 'Health' },
      { key: 'symptoms', name: 'Symptoms' },
    ],
    version: 'test',
  }
  const created = {
    color: '#000000',
    display_category: 'other' as const,
    display_name: 'x',
    is_builtin: false,
    name: 'x',
    show_on_timeline: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getActivityTypeDefinition).mockResolvedValue(null)
    vi.mocked(db.insertActivityTypeDefinition).mockResolvedValue(created)
  })

  test('a name alone takes every field from the catalogue', async () => {
    const result = await addActivityTypeDefinition(user, { name: 'sauna' }, catalog)
    expect(result.success).toBe(true)
    expect(db.insertActivityTypeDefinition).toHaveBeenCalledWith(user, {
      aliases: ['hot room'],
      color: '#f97316',
      data_schema: { fields: [{ min: 0, name: 'rounds', type: 'number' }] },
      display_category: 'wellness',
      display_name: 'Sauna',
      icon: '🧖',
      name: 'sauna',
      parent_type: undefined,
    })
    expect(db.adoptCatalogActivityType).not.toHaveBeenCalled()
  })

  test("the caller's fields win and aliases are joined", async () => {
    const data_schema = { fields: [{ name: 'notes', type: 'string' as const }] }
    await addActivityTypeDefinition(
      user,
      { aliases: ['bastu'], data_schema, display_name: 'Bastu', name: 'sauna' },
      catalog,
    )
    expect(db.insertActivityTypeDefinition).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        aliases: ['bastu', 'hot room'],
        data_schema,
        display_category: 'wellness',
        display_name: 'Bastu',
      }),
    )
  })

  test('a sub-type adopts its catalogue parent first', async () => {
    await addActivityTypeDefinition(user, { name: 'headache' }, catalog)
    expect(db.adoptCatalogActivityType).toHaveBeenCalledWith(user, 'symptom', catalog)
    expect(db.insertActivityTypeDefinition).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ display_category: 'health', parent_type: 'symptom' }),
    )
  })

  test('a parent the caller gives is used as given', async () => {
    await addActivityTypeDefinition(user, { name: 'headache', parent_type: 'pain' }, catalog)
    expect(db.adoptCatalogActivityType).not.toHaveBeenCalled()
    expect(db.insertActivityTypeDefinition).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ parent_type: 'pain' }),
    )
  })

  test('a name outside the catalogue needs a display name and category', async () => {
    const result = await addActivityTypeDefinition(
      user,
      { display_name: 'Driving', name: 'driving' },
      catalog,
    )
    expect(result).toEqual({
      error:
        'display_name and display_category are required for a type that is not in the built-in catalogue',
      success: false,
    })
    expect(db.insertActivityTypeDefinition).not.toHaveBeenCalled()
  })

  describe('listActivityTypeCatalog', () => {
    const def = (name: string, data_schema?: { fields: { name: string; type: 'number' | 'string' }[] }) => ({
      color: '#000000',
      data_schema,
      display_category: 'other' as const,
      display_name: name,
      is_builtin: false,
      name,
      show_on_timeline: true,
    })

    test('marks the types in use', async () => {
      vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([def('sauna'), def('sleep')])
      const result = await listActivityTypeCatalog(user, undefined, catalog)
      expect(result.version).toBe('test')
      expect(result.groups).toEqual(catalog.groups)
      expect(result.entries.map((e) => [e.name, e.in_use])).toEqual([
        ['sauna', true],
        ['symptom', false],
        ['headache', false],
      ])
    })

    test('lists the catalogue fields a type in use lacks', async () => {
      vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([
        def('sauna'),
        def('headache', { fields: [{ name: 'severity', type: 'number' }] }),
      ])
      const result = await listActivityTypeCatalog(user, undefined, catalog)
      expect(result.entries.map((e) => [e.name, e.missing_fields])).toEqual([
        ['sauna', ['rounds']],
        ['symptom', []],
        ['headache', []],
      ])
    })

    test('filters by q', async () => {
      vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([])
      const result = await listActivityTypeCatalog(user, 'head', catalog)
      expect(result.entries.map((e) => e.name)).toEqual(['headache'])
    })
  })

  describe('addCatalogFieldsToActivityType', () => {
    const sauna = {
      color: '#000000',
      display_category: 'wellness' as const,
      display_name: 'Bastu',
      is_builtin: false,
      name: 'sauna',
      show_on_timeline: true,
    }

    test('is a not-found error for a type the user does not have', async () => {
      const result = await addCatalogFieldsToActivityType(user, 'sauna', catalog)
      expect(result).toEqual({ error: 'Activity type "sauna" not found', success: false })
      expect(db.updateActivityTypeDefinition).not.toHaveBeenCalled()
    })

    test('is an error for a type that is not in the catalogue', async () => {
      vi.mocked(db.getActivityTypeDefinition).mockResolvedValue({ ...sauna, name: 'driving' })
      const result = await addCatalogFieldsToActivityType(user, 'driving', catalog)
      expect(result).toEqual({ error: '"driving" is not a built-in catalogue type', success: false })
      expect(db.updateActivityTypeDefinition).not.toHaveBeenCalled()
    })

    test('changes nothing when no field is missing', async () => {
      const complete = { ...sauna, data_schema: { fields: [{ name: 'rounds', type: 'string' as const }] } }
      vi.mocked(db.getActivityTypeDefinition).mockResolvedValue(complete)
      const result = await addCatalogFieldsToActivityType(user, 'sauna', catalog)
      expect(result).toEqual({ data: complete, success: true })
      expect(db.updateActivityTypeDefinition).not.toHaveBeenCalled()
    })

    test('appends the missing fields after the existing ones', async () => {
      const notes = { name: 'notes', type: 'string' as const }
      vi.mocked(db.getActivityTypeDefinition).mockResolvedValue({
        ...sauna,
        data_schema: { fields: [notes] },
      })
      vi.mocked(db.updateActivityTypeDefinition).mockResolvedValue(sauna)
      const result = await addCatalogFieldsToActivityType(user, 'sauna', catalog)
      expect(result).toEqual({ data: sauna, success: true })
      expect(db.updateActivityTypeDefinition).toHaveBeenCalledWith(user, 'sauna', {
        data_schema: { fields: [notes, { min: 0, name: 'rounds', type: 'number' }] },
      })
    })

    test('gives a type without a schema all the catalogue fields', async () => {
      vi.mocked(db.getActivityTypeDefinition).mockResolvedValue(sauna)
      vi.mocked(db.updateActivityTypeDefinition).mockResolvedValue(sauna)
      await addCatalogFieldsToActivityType(user, 'sauna', catalog)
      expect(db.updateActivityTypeDefinition).toHaveBeenCalledWith(user, 'sauna', {
        data_schema: { fields: [{ min: 0, name: 'rounds', type: 'number' }] },
      })
    })
  })
})

describe('updateActivityTypeDefinition', () => {
  beforeEach(() => vi.clearAllMocks())

  test('updates display metadata', async () => {
    vi.mocked(db.getActivityTypeDefinition).mockResolvedValue({
      color: '#ef4444',
      display_category: 'wellness' as const,
      display_name: 'Sauna',
      is_builtin: false,
      name: 'sauna',
      show_on_timeline: true,
    })
    vi.mocked(db.updateActivityTypeDefinition).mockResolvedValue({
      color: '#f97316',
      display_category: 'wellness' as const,
      display_name: 'Hot Sauna',
      is_builtin: false,
      name: 'sauna',
      show_on_timeline: true,
    })

    const result = await updateActivityTypeDefinition(user, 'sauna', {
      color: '#f97316',
      display_name: 'Hot Sauna',
    })

    expect(result.success).toBe(true)
    expect(result.data?.display_name).toBe('Hot Sauna')
  })

  test('returns error for non-existent type', async () => {
    vi.mocked(db.getActivityTypeDefinition).mockResolvedValue(null)

    const result = await updateActivityTypeDefinition(user, 'nonexistent', { display_name: 'New' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('deleteActivityTypeDefinition', () => {
  beforeEach(() => vi.clearAllMocks())

  test('deletes a custom type', async () => {
    vi.mocked(db.deleteActivityTypeDefinition).mockResolvedValue(true)

    const result = await deleteActivityTypeDefinition(user, 'sauna')
    expect(result.success).toBe(true)
  })

  test('rejects deleting built-in types', async () => {
    const result = await deleteActivityTypeDefinition(user, 'exercise')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot delete built-in')
    expect(db.deleteActivityTypeDefinition).not.toHaveBeenCalled()
  })

  test('returns error when type not found', async () => {
    vi.mocked(db.deleteActivityTypeDefinition).mockResolvedValue(false)

    const result = await deleteActivityTypeDefinition(user, 'nonexistent')

    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('renameActivityTypeDefinition', () => {
  beforeEach(() => vi.clearAllMocks())

  test('returns error when old and new name are the same', async () => {
    const result = await renameActivityTypeDefinition(user, 'sauna', 'sauna')
    expect(result.success).toBe(false)
    expect(result.error).toContain('same as the current name')
  })

  test('returns error when renaming a built-in type', async () => {
    const result = await renameActivityTypeDefinition(user, 'sleep', 'slumber')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot rename built-in')
  })

  test('returns error when renaming to a built-in type name', async () => {
    const result = await renameActivityTypeDefinition(user, 'sauna', 'exercise')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot rename to built-in')
  })

  test('returns error when db rename fails', async () => {
    vi.mocked(db.renameActivityTypeDefinition).mockResolvedValue(null)

    const result = await renameActivityTypeDefinition(user, 'sauna', 'hot_sauna')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  test('renames custom type successfully', async () => {
    const renamedDef = {
      color: '#ef4444',
      display_category: 'wellness' as const,
      display_name: 'Sauna',
      is_builtin: false,
      name: 'hot_sauna',
      show_on_timeline: true,
    }
    vi.mocked(db.renameActivityTypeDefinition).mockResolvedValue({
      activities_updated: 3,
      deduction_rules_updated: 1,
      definition: renamedDef,
    })

    const result = await renameActivityTypeDefinition(user, 'sauna', 'hot_sauna')

    expect(result.success).toBe(true)
    expect(result.data).toEqual(renamedDef)
    expect(result.activities_updated).toBe(3)
    expect(result.deduction_rules_updated).toBe(1)
    expect(db.renameActivityTypeDefinition).toHaveBeenCalledWith(user, 'sauna', 'hot_sauna')
  })
})

describe('mergeActivityType', () => {
  beforeEach(() => vi.clearAllMocks())

  test('returns error when source equals target', async () => {
    const result = await mergeActivityType(user, 'sauna', 'sauna')
    expect(result.success).toBe(false)
    expect(result.error).toContain('same activity type')
  })

  test('returns error when source is built-in', async () => {
    const result = await mergeActivityType(user, 'exercise', 'sauna')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot merge built-in')
  })

  const targetDef = {
    aliases: ['sauna', 'old_sauna'],
    color: '#ef4444',
    data_schema: {
      fields: [
        { enum_values: ['dry', 'steam'], name: 'kind', type: 'string' as const },
        { name: 'sets', type: 'list' as const },
      ],
    },
    display_category: 'wellness' as const,
    display_name: 'Sauna',
    is_builtin: false,
    name: 'sauna',
    show_on_timeline: true,
  }
  const sourceDef = { ...targetDef, aliases: ['old_sauna'], data_schema: undefined, name: 'old_sauna' }

  const alcoholCatalog: StoredActivityTypeCatalog = {
    entries: [
      {
        aliases: [],
        color: '#000000',
        data_schema: { fields: [{ enum_values: ['beer', 'wine'], name: 'kind', type: 'string' }] },
        display_category: 'intake',
        display_name: 'Alcohol',
        group: 'intake',
        icon: '',
        name: 'alcohol',
        same_as: {},
      },
    ],
    groups: [],
    version: 'test',
  }

  const givenTypes = (...defs: ActivityTypeDefinition[]) => {
    vi.mocked(db.getActivityTypeDefinition).mockImplementation(
      async (_user, name) => defs.find((d) => d.name === name) ?? null,
    )
    vi.mocked(db.ensureActivityType).mockImplementation(async (_user, name) =>
      defs.some((d) => d.name === name),
    )
  }

  test('returns error when the source is not found, without adopting the target', async () => {
    givenTypes(targetDef)

    const result = await mergeActivityType(user, 'old_type', 'sauna')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
    expect(db.ensureActivityType).not.toHaveBeenCalled()
    expect(db.mergeActivityTypeDefinition).not.toHaveBeenCalled()
  })

  test("returns error when the target is neither the user's nor a catalogue type", async () => {
    givenTypes(sourceDef)

    const result = await mergeActivityType(user, 'old_sauna', 'new_type')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
    expect(db.ensureActivityType).not.toHaveBeenCalled()
    expect(db.mergeActivityTypeDefinition).not.toHaveBeenCalled()
  })

  test('returns error when the db merge finds nothing', async () => {
    givenTypes(sourceDef, targetDef)
    vi.mocked(db.mergeActivityTypeDefinition).mockResolvedValue(null)

    const result = await mergeActivityType(user, 'old_sauna', 'sauna')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  test('merges custom type into target successfully', async () => {
    givenTypes(sourceDef, targetDef)
    vi.mocked(db.mergeActivityTypeDefinition).mockResolvedValue({
      activities_data_set: 0,
      activities_reassigned: 5,
      deduction_rules_updated: 1,
      target: targetDef,
    })

    const result = await mergeActivityType(user, 'old_sauna', 'sauna')

    expect(result.success).toBe(true)
    expect(result.activities_reassigned).toBe(5)
    expect(result.deduction_rules_updated).toBe(1)
    expect(result.target).toEqual(targetDef)
    expect(db.mergeActivityTypeDefinition).toHaveBeenCalledWith(user, 'old_sauna', 'sauna', undefined)
  })

  test('adopts a catalogue target before merging into it', async () => {
    givenTypes(sourceDef)
    vi.mocked(db.ensureActivityType).mockResolvedValue(true)
    vi.mocked(db.mergeActivityTypeDefinition).mockResolvedValue({
      activities_data_set: 0,
      activities_reassigned: 1,
      deduction_rules_updated: 0,
      target: targetDef,
    })

    const result = await mergeActivityType(user, 'old_sauna', 'alcohol', undefined, alcoholCatalog)

    expect(result.success).toBe(true)
    expect(db.ensureActivityType).toHaveBeenCalledWith(user, 'alcohol', alcoholCatalog)
    expect(db.mergeActivityTypeDefinition).toHaveBeenCalledWith(user, 'old_sauna', 'alcohol', undefined)
  })

  test('refuses bad set_data for a catalogue target without adopting it', async () => {
    givenTypes(sourceDef)

    const result = await mergeActivityType(user, 'old_sauna', 'alcohol', { kind: 'mead' }, alcoholCatalog)

    expect(result).toEqual({
      error: 'set_data is not valid for "alcohol": Field "kind" value "mead" is not one of: beer, wine',
      success: false,
    })
    expect(db.ensureActivityType).not.toHaveBeenCalled()
    expect(db.mergeActivityTypeDefinition).not.toHaveBeenCalled()
  })

  test('passes valid set_data on and reports activities_data_set', async () => {
    givenTypes(sourceDef, targetDef)
    vi.mocked(db.mergeActivityTypeDefinition).mockResolvedValue({
      activities_data_set: 4,
      activities_reassigned: 5,
      deduction_rules_updated: 0,
      target: targetDef,
    })

    const result = await mergeActivityType(user, 'old_sauna', 'sauna', { kind: 'steam' })

    expect(result).toMatchObject({ activities_data_set: 4, activities_reassigned: 5, success: true })
    expect(db.mergeActivityTypeDefinition).toHaveBeenCalledWith(user, 'old_sauna', 'sauna', { kind: 'steam' })
  })

  test('treats an empty set_data as none', async () => {
    givenTypes(sourceDef, targetDef)
    vi.mocked(db.mergeActivityTypeDefinition).mockResolvedValue({
      activities_data_set: 0,
      activities_reassigned: 1,
      deduction_rules_updated: 0,
      target: targetDef,
    })

    await mergeActivityType(user, 'old_sauna', 'sauna', {})

    expect(db.mergeActivityTypeDefinition).toHaveBeenCalledWith(user, 'old_sauna', 'sauna', undefined)
  })

  test('refuses set_data the target schema does not allow, merging nothing', async () => {
    givenTypes(sourceDef, targetDef)

    const result = await mergeActivityType(user, 'old_sauna', 'sauna', {
      colour: 'red',
      kind: 'wet',
      sets: [],
    })

    expect(result).toEqual({
      error:
        'set_data is not valid for "sauna": Field "colour" is not a field of this type; Field "kind" value "wet" is not one of: dry, steam; Field "sets" is a list and cannot be set this way',
      success: false,
    })
    expect(db.mergeActivityTypeDefinition).not.toHaveBeenCalled()
  })

  describe('a target of a catalogue name that lacks the field set_data names', () => {
    const ownAlcohol = {
      ...sourceDef,
      aliases: ['alcohol'],
      data_schema: { fields: [{ name: 'drinks', type: 'number' as const }] },
      name: 'alcohol',
    }
    const merged = {
      activities_data_set: 2,
      activities_reassigned: 2,
      deduction_rules_updated: 0,
      target: ownAlcohol,
    }

    test('gets that catalogue field appended, then the merge runs', async () => {
      givenTypes(sourceDef, ownAlcohol)
      vi.mocked(db.updateActivityTypeDefinition).mockResolvedValue(ownAlcohol)
      vi.mocked(db.mergeActivityTypeDefinition).mockResolvedValue(merged)

      const result = await mergeActivityType(user, 'old_sauna', 'alcohol', { kind: 'beer' }, alcoholCatalog)

      expect(result.success).toBe(true)
      expect(db.updateActivityTypeDefinition).toHaveBeenCalledWith(user, 'alcohol', {
        data_schema: {
          fields: [
            { name: 'drinks', type: 'number' },
            { enum_values: ['beer', 'wine'], name: 'kind', type: 'string' },
          ],
        },
      })
      expect(db.mergeActivityTypeDefinition).toHaveBeenCalledWith(user, 'old_sauna', 'alcohol', {
        kind: 'beer',
      })
    })

    test('is still refused for a value the catalogue field does not allow, changing nothing', async () => {
      givenTypes(sourceDef, ownAlcohol)

      const result = await mergeActivityType(user, 'old_sauna', 'alcohol', { kind: 'mead' }, alcoholCatalog)

      expect(result.error).toBe(
        'set_data is not valid for "alcohol": Field "kind" value "mead" is not one of: beer, wine',
      )
      expect(db.updateActivityTypeDefinition).not.toHaveBeenCalled()
      expect(db.mergeActivityTypeDefinition).not.toHaveBeenCalled()
    })

    test('is still refused for a field the catalogue does not have either', async () => {
      givenTypes(sourceDef, ownAlcohol)

      const result = await mergeActivityType(user, 'old_sauna', 'alcohol', { colour: 'red' }, alcoholCatalog)

      expect(result.error).toBe(
        'set_data is not valid for "alcohol": Field "colour" is not a field of this type',
      )
      expect(db.updateActivityTypeDefinition).not.toHaveBeenCalled()
    })

    test('leaves the schema alone when the target has the field or no set_data is given', async () => {
      givenTypes(sourceDef, ownAlcohol)
      vi.mocked(db.mergeActivityTypeDefinition).mockResolvedValue(merged)

      await mergeActivityType(user, 'old_sauna', 'alcohol', { drinks: 2 }, alcoholCatalog)
      await mergeActivityType(user, 'old_sauna', 'alcohol', undefined, alcoholCatalog)

      expect(db.updateActivityTypeDefinition).not.toHaveBeenCalled()
      expect(db.mergeActivityTypeDefinition).toHaveBeenCalledTimes(2)
    })
  })

  test('refuses set_data for a target without a schema', async () => {
    givenTypes(sourceDef, { ...sourceDef, name: 'plain' })

    const result = await mergeActivityType(user, 'old_sauna', 'plain', { kind: 'dry' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('set_data is not valid for "plain": Field "kind" is not a field of this type')
  })
})
