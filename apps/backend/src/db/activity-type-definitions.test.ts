import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  activityTypeExists,
  deleteActivityTypeDefinition,
  getActivityTypeDefinition,
  getActivityTypeDefinitions,
  getActivityTypeNames,
  insertActivityTypeDefinition,
  updateActivityTypeDefinition,
} from './activity-type-definitions.ts'

vi.mock('./connection.ts', () => ({
  query: vi.fn(),
}))

import { query } from './connection.ts'

const user = 'testuser'
const mockQuery = vi.mocked(query)

describe('activity-type-definitions db', () => {
  beforeEach(() => vi.clearAllMocks())

  test('getActivityTypeDefinitions returns mapped rows', async () => {
    mockQuery.mockResolvedValue({
      command: 'SELECT',
      fields: [],
      oid: 0,
      rowCount: 1,
      rows: [
        {
          color: '#3b82f6',
          display_category: 'sleep_rest',
          display_name: 'Sleep',
          icon: null,
          is_builtin: true,
          name: 'sleep',
          show_on_timeline: true,
        },
      ],
    })

    const result = await getActivityTypeDefinitions(user)
    expect(result).toEqual([
      {
        color: '#3b82f6',
        display_category: 'sleep_rest',
        display_name: 'Sleep',
        is_builtin: true,
        name: 'sleep',
        show_on_timeline: true,
      },
    ])
  })

  test('getActivityTypeDefinition returns null when not found', async () => {
    mockQuery.mockResolvedValue({ command: 'SELECT', fields: [], oid: 0, rowCount: 0, rows: [] })

    const result = await getActivityTypeDefinition(user, 'nonexistent')
    expect(result).toBeNull()
  })

  test('getActivityTypeDefinition returns definition when found', async () => {
    mockQuery.mockResolvedValue({
      command: 'SELECT',
      fields: [],
      oid: 0,
      rowCount: 1,
      rows: [
        {
          color: '#ef4444',
          display_category: 'wellness',
          display_name: 'Sauna',
          icon: '🧖',
          is_builtin: false,
          name: 'sauna',
          show_on_timeline: true,
        },
      ],
    })

    const result = await getActivityTypeDefinition(user, 'sauna')
    expect(result).toEqual({
      color: '#ef4444',
      display_category: 'wellness',
      display_name: 'Sauna',
      icon: '🧖',
      is_builtin: false,
      name: 'sauna',
      show_on_timeline: true,
    })
  })

  test('activityTypeExists returns true when exists', async () => {
    mockQuery.mockResolvedValue({
      command: 'SELECT',
      fields: [],
      oid: 0,
      rowCount: 1,
      rows: [{ '?column?': 1 }],
    })

    expect(await activityTypeExists(user, 'sleep')).toBe(true)
  })

  test('activityTypeExists returns false when missing', async () => {
    mockQuery.mockResolvedValue({ command: 'SELECT', fields: [], oid: 0, rowCount: 0, rows: [] })

    expect(await activityTypeExists(user, 'nonexistent')).toBe(false)
  })

  test('insertActivityTypeDefinition inserts and returns definition', async () => {
    mockQuery.mockResolvedValue({
      command: 'INSERT',
      fields: [],
      oid: 0,
      rowCount: 1,
      rows: [
        {
          color: '#ef4444',
          display_category: 'wellness',
          display_name: 'Sauna',
          icon: null,
          is_builtin: false,
          name: 'sauna',
          show_on_timeline: true,
        },
      ],
    })

    const result = await insertActivityTypeDefinition(user, {
      display_category: 'wellness',
      display_name: 'Sauna',
      name: 'sauna',
    })
    expect(result.name).toBe('sauna')
    expect(result.color).toBe('#ef4444')
  })

  test('updateActivityTypeDefinition returns null when not found', async () => {
    mockQuery.mockResolvedValue({ command: 'UPDATE', fields: [], oid: 0, rowCount: 0, rows: [] })

    const result = await updateActivityTypeDefinition(user, 'nonexistent', { display_name: 'New' })
    expect(result).toBeNull()
  })

  test('updateActivityTypeDefinition builds SET clauses for provided fields', async () => {
    mockQuery.mockResolvedValue({
      command: 'UPDATE',
      fields: [],
      oid: 0,
      rowCount: 1,
      rows: [
        {
          color: '#f97316',
          display_category: 'wellness',
          display_name: 'Hot Sauna',
          icon: '🔥',
          is_builtin: false,
          name: 'sauna',
          show_on_timeline: true,
        },
      ],
    })

    const result = await updateActivityTypeDefinition(user, 'sauna', {
      color: '#f97316',
      display_category: 'wellness',
      display_name: 'Hot Sauna',
      icon: '🔥',
    })
    expect(result?.display_name).toBe('Hot Sauna')
    expect(result?.icon).toBe('🔥')
  })

  test('updateActivityTypeDefinition returns existing when no fields provided', async () => {
    mockQuery.mockResolvedValue({
      command: 'SELECT',
      fields: [],
      oid: 0,
      rowCount: 1,
      rows: [
        {
          color: '#ef4444',
          display_category: 'wellness',
          display_name: 'Sauna',
          icon: null,
          is_builtin: false,
          name: 'sauna',
          show_on_timeline: true,
        },
      ],
    })

    const result = await updateActivityTypeDefinition(user, 'sauna', {})
    expect(result?.name).toBe('sauna')
  })

  test('deleteActivityTypeDefinition returns true on success', async () => {
    mockQuery.mockResolvedValue({ command: 'DELETE', fields: [], oid: 0, rowCount: 1, rows: [] })

    expect(await deleteActivityTypeDefinition(user, 'sauna')).toBe(true)
  })

  test('deleteActivityTypeDefinition returns false when not found', async () => {
    mockQuery.mockResolvedValue({ command: 'DELETE', fields: [], oid: 0, rowCount: 0, rows: [] })

    expect(await deleteActivityTypeDefinition(user, 'nonexistent')).toBe(false)
  })

  test('getActivityTypeNames returns name array', async () => {
    mockQuery.mockResolvedValue({
      command: 'SELECT',
      fields: [],
      oid: 0,
      rowCount: 2,
      rows: [{ name: 'exercise' }, { name: 'sleep' }],
    })

    const result = await getActivityTypeNames(user)
    expect(result).toEqual(['exercise', 'sleep'])
  })
})
