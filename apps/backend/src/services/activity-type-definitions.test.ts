import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import {
  addActivityTypeDefinition,
  deleteActivityTypeDefinition,
  listActivityTypeDefinitions,
  updateActivityTypeDefinition,
} from './activity-type-definitions.ts'

vi.mock('../db', () => ({
  deleteActivityTypeDefinition: vi.fn(),
  getActivityTypeDefinition: vi.fn(),
  getActivityTypeDefinitions: vi.fn(),
  insertActivityTypeDefinition: vi.fn(),
  updateActivityTypeDefinition: vi.fn(),
}))

const user = 'testuser'

describe('listActivityTypeDefinitions', () => {
  beforeEach(() => vi.clearAllMocks())

  test('returns all definitions from db', async () => {
    const defs = [
      { color: '#3b82f6', display_category: 'sleep_rest' as const, display_name: 'Sleep', is_builtin: true, name: 'sleep' },
      { color: '#ef4444', display_category: 'wellness' as const, display_name: 'Sauna', is_builtin: false, name: 'sauna' },
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
    })
    vi.mocked(db.updateActivityTypeDefinition).mockResolvedValue({
      color: '#f97316',
      display_category: 'wellness' as const,
      display_name: 'Hot Sauna',
      is_builtin: false,
      name: 'sauna',
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
