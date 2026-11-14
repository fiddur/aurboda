import type { StoredActivityTypeCatalog } from '@aurboda/api-spec'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import {
  addActivityTypeDefinition,
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
  getActivityTypeDefinition: vi.fn(),
  getActivityTypeDefinitions: vi.fn(),
  getActivityTypeNames: vi.fn(),
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
    test('marks the types in use', async () => {
      vi.mocked(db.getActivityTypeNames).mockResolvedValue(['sauna', 'sleep'])
      const result = await listActivityTypeCatalog(user, undefined, catalog)
      expect(result.version).toBe('test')
      expect(result.groups).toEqual(catalog.groups)
      expect(result.entries.map((e) => [e.name, e.in_use])).toEqual([
        ['sauna', true],
        ['symptom', false],
        ['headache', false],
      ])
    })

    test('filters by q', async () => {
      vi.mocked(db.getActivityTypeNames).mockResolvedValue([])
      const result = await listActivityTypeCatalog(user, 'head', catalog)
      expect(result.entries.map((e) => e.name)).toEqual(['headache'])
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

  test('returns error when source or target not found', async () => {
    vi.mocked(db.mergeActivityTypeDefinition).mockResolvedValue(null)

    const result = await mergeActivityType(user, 'old_type', 'new_type')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  test('merges custom type into target successfully', async () => {
    const targetDef = {
      aliases: ['sauna', 'old_sauna'],
      color: '#ef4444',
      display_category: 'wellness' as const,
      display_name: 'Sauna',
      is_builtin: false,
      name: 'sauna',
      show_on_timeline: true,
    }
    vi.mocked(db.mergeActivityTypeDefinition).mockResolvedValue({
      activities_reassigned: 5,
      deduction_rules_updated: 1,
      target: targetDef,
    })

    const result = await mergeActivityType(user, 'old_sauna', 'sauna')

    expect(result.success).toBe(true)
    expect(result.activities_reassigned).toBe(5)
    expect(result.deduction_rules_updated).toBe(1)
    expect(result.target).toEqual(targetDef)
    expect(db.mergeActivityTypeDefinition).toHaveBeenCalledWith(user, 'old_sauna', 'sauna')
  })
})
