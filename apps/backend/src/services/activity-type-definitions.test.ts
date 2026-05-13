import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import {
  addActivityTypeDefinition,
  deleteActivityTypeDefinition,
  listActivityTypeDefinitions,
  mergeActivityType,
  renameActivityTypeDefinition,
  updateActivityTypeDefinition,
} from './activity-type-definitions.ts'

vi.mock('../db', () => ({
  deleteActivityTypeDefinition: vi.fn(),
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
