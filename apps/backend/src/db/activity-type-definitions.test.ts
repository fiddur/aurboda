import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  activityTypeExists,
  deleteActivityTypeDefinition,
  getActivityTypeDefinition,
  getActivityTypeDefinitions,
  getActivityTypeNames,
  insertActivityTypeDefinition,
  mergeActivityTypeDefinition,
  renameActivityTypeDefinition,
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
        aliases: [],
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
      aliases: [],
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

  test('renameActivityTypeDefinition returns null for same name', async () => {
    const result = await renameActivityTypeDefinition(user, 'sauna', 'sauna')
    expect(result).toBeNull()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  test('renameActivityTypeDefinition returns null when source not found', async () => {
    mockQuery.mockResolvedValue({ command: 'SELECT', fields: [], oid: 0, rowCount: 0, rows: [] })

    const result = await renameActivityTypeDefinition(user, 'nonexistent', 'new_name')
    expect(result).toBeNull()
  })

  test('renameActivityTypeDefinition returns null when source is built-in', async () => {
    mockQuery.mockResolvedValue({
      command: 'SELECT',
      fields: [],
      oid: 0,
      rowCount: 1,
      rows: [
        {
          aliases: ['sleep'],
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

    const result = await renameActivityTypeDefinition(user, 'sleep', 'slumber')
    expect(result).toBeNull()
  })

  test('renameActivityTypeDefinition returns null when new name already exists', async () => {
    mockQuery
      // 1. Get source definition
      .mockResolvedValueOnce({
        command: 'SELECT',
        fields: [],
        oid: 0,
        rowCount: 1,
        rows: [
          {
            aliases: ['sauna'],
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
      // 2. Check if new name exists — it does
      .mockResolvedValueOnce({
        command: 'SELECT',
        fields: [],
        oid: 0,
        rowCount: 1,
        rows: [{ '?column?': 1 }],
      })

    const result = await renameActivityTypeDefinition(user, 'sauna', 'hot_bath')
    expect(result).toBeNull()
  })

  test('renameActivityTypeDefinition renames and updates references', async () => {
    const sourceDef = {
      aliases: ['sauna'],
      color: '#ef4444',
      display_category: 'wellness',
      display_name: 'Sauna',
      icon: '🧖',
      is_builtin: false,
      name: 'sauna',
      show_on_timeline: true,
    }

    mockQuery
      // 1. Get source definition
      .mockResolvedValueOnce({ command: 'SELECT', fields: [], oid: 0, rowCount: 1, rows: [sourceDef] })
      // 2. Check new name doesn't exist
      .mockResolvedValueOnce({ command: 'SELECT', fields: [], oid: 0, rowCount: 0, rows: [] })
      // 3. Count activities to update
      .mockResolvedValueOnce({ command: 'SELECT', fields: [], oid: 0, rowCount: 1, rows: [{ count: '5' }] })
      // 4. Count deduction rules to update
      .mockResolvedValueOnce({ command: 'SELECT', fields: [], oid: 0, rowCount: 1, rows: [{ count: '2' }] })
      // 5. Update definition name and aliases (FK ON UPDATE CASCADE handles activities + rules)
      .mockResolvedValueOnce({
        command: 'UPDATE',
        fields: [],
        oid: 0,
        rowCount: 1,
        rows: [{ ...sourceDef, aliases: ['hot_sauna'], name: 'hot_sauna' }],
      })
      // 6. Update deduction rules conditions JSONB (not covered by FK)
      .mockResolvedValueOnce({ command: 'UPDATE', fields: [], oid: 0, rowCount: 1, rows: [] })

    const result = await renameActivityTypeDefinition(user, 'sauna', 'hot_sauna')

    expect(result).not.toBeNull()
    expect(result!.definition.name).toBe('hot_sauna')
    expect(result!.activities_updated).toBe(5)
    expect(result!.deduction_rules_updated).toBe(3)
  })

  test('mergeActivityTypeDefinition returns null for self-merge', async () => {
    const result = await mergeActivityTypeDefinition(user, 'sauna', 'sauna')
    expect(result).toBeNull()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  test('mergeActivityTypeDefinition returns null when source not found', async () => {
    mockQuery.mockResolvedValue({ command: 'SELECT', fields: [], oid: 0, rowCount: 0, rows: [] })

    const result = await mergeActivityTypeDefinition(user, 'nonexistent', 'exercise')
    expect(result).toBeNull()
  })

  test('mergeActivityTypeDefinition returns null when source is built-in', async () => {
    mockQuery.mockResolvedValue({
      command: 'SELECT',
      fields: [],
      oid: 0,
      rowCount: 1,
      rows: [
        {
          aliases: ['exercise'],
          color: '#3b82f6',
          display_category: 'exercise',
          display_name: 'Exercise',
          icon: null,
          is_builtin: true,
          name: 'exercise',
          show_on_timeline: true,
        },
      ],
    })

    const result = await mergeActivityTypeDefinition(user, 'exercise', 'sauna')
    expect(result).toBeNull()
  })

  test('mergeActivityTypeDefinition merges custom type into target', async () => {
    const sourceDef = {
      aliases: ['old_sauna'],
      color: '#ef4444',
      display_category: 'wellness',
      display_name: 'Old Sauna',
      icon: null,
      is_builtin: false,
      name: 'old_sauna',
      show_on_timeline: true,
    }
    const targetDef = {
      aliases: ['sauna'],
      color: '#f97316',
      display_category: 'wellness',
      display_name: 'Sauna',
      icon: '🧖',
      is_builtin: false,
      name: 'sauna',
      show_on_timeline: true,
    }

    mockQuery
      // 1. Get source definition
      .mockResolvedValueOnce({ command: 'SELECT', fields: [], oid: 0, rowCount: 1, rows: [sourceDef] })
      // 2. Get target definition
      .mockResolvedValueOnce({ command: 'SELECT', fields: [], oid: 0, rowCount: 1, rows: [targetDef] })
      // 3. Update target aliases
      .mockResolvedValueOnce({ command: 'UPDATE', fields: [], oid: 0, rowCount: 1, rows: [] })
      // 4. Reassign activities
      .mockResolvedValueOnce({ command: 'UPDATE', fields: [], oid: 0, rowCount: 3, rows: [] })
      // 5. Update deduction rules output_activity_type
      .mockResolvedValueOnce({ command: 'UPDATE', fields: [], oid: 0, rowCount: 1, rows: [] })
      // 6. Update deduction rules conditions
      .mockResolvedValueOnce({ command: 'UPDATE', fields: [], oid: 0, rowCount: 0, rows: [] })
      // 7. Delete source
      .mockResolvedValueOnce({ command: 'DELETE', fields: [], oid: 0, rowCount: 1, rows: [] })
      // 8. Get updated target (getActivityTypeDefinition)
      .mockResolvedValueOnce({
        command: 'SELECT',
        fields: [],
        oid: 0,
        rowCount: 1,
        rows: [{ ...targetDef, aliases: ['sauna', 'old_sauna'] }],
      })

    const result = await mergeActivityTypeDefinition(user, 'old_sauna', 'sauna')

    expect(result).not.toBeNull()
    expect(result!.activities_reassigned).toBe(3)
    expect(result!.deduction_rules_updated).toBe(1)
    expect(result!.target.name).toBe('sauna')
  })
})
