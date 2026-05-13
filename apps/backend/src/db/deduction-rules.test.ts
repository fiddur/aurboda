import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  deleteDeductionRule,
  deleteRuleActivities,
  deleteStaleRuleActivities,
  getDeductionRule,
  getDeductionRules,
  getEnabledDeductionRules,
  insertDeductionRule,
  insertDeductionRuleRun,
  updateDeductionRule,
} from './deduction-rules.ts'

vi.mock('./connection.ts', () => ({
  query: vi.fn(),
}))

import { query } from './connection.ts'

const user = 'testuser'
const mockQuery = vi.mocked(query)

const mockRule = {
  conditions: [{ activity_type: 'sauna', kind: 'activity' }],
  created_at: new Date('2024-01-15T10:00:00Z'),
  enabled: true,
  id: 'rule-1',
  merge_gap_seconds: null,
  name: 'Sauna rule',
  output_activity_type: 'sauna',
  output_title: null,
  priority: 0,
}

describe('deduction-rules db', () => {
  beforeEach(() => vi.clearAllMocks())

  test('getDeductionRules returns mapped rules', async () => {
    mockQuery.mockResolvedValue({ command: 'SELECT', fields: [], oid: 0, rowCount: 1, rows: [mockRule] })
    const result = await getDeductionRules(user)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Sauna rule')
  })

  test('getEnabledDeductionRules filters by enabled', async () => {
    mockQuery.mockResolvedValue({ command: 'SELECT', fields: [], oid: 0, rowCount: 0, rows: [] })
    const result = await getEnabledDeductionRules(user)
    expect(result).toEqual([])
    expect(mockQuery).toHaveBeenCalledWith(user, expect.stringContaining('enabled = true'))
  })

  test('getDeductionRule returns null when not found', async () => {
    mockQuery.mockResolvedValue({ command: 'SELECT', fields: [], oid: 0, rowCount: 0, rows: [] })
    expect(await getDeductionRule(user, 'nonexistent')).toBeNull()
  })

  test('getDeductionRule returns rule when found', async () => {
    mockQuery.mockResolvedValue({ command: 'SELECT', fields: [], oid: 0, rowCount: 1, rows: [mockRule] })
    const result = await getDeductionRule(user, 'rule-1')
    expect(result?.id).toBe('rule-1')
  })

  test('insertDeductionRule inserts and returns rule', async () => {
    mockQuery.mockResolvedValue({ command: 'INSERT', fields: [], oid: 0, rowCount: 1, rows: [mockRule] })
    const result = await insertDeductionRule(user, {
      conditions: [{ activity_type: 'sauna', kind: 'activity' as const }],
      name: 'Sauna rule',
      output_activity_type: 'sauna',
    })
    expect(result.name).toBe('Sauna rule')
  })

  test('updateDeductionRule returns null when not found', async () => {
    mockQuery.mockResolvedValue({ command: 'UPDATE', fields: [], oid: 0, rowCount: 0, rows: [] })
    expect(await updateDeductionRule(user, 'nonexistent', { name: 'New' })).toBeNull()
  })

  test('updateDeductionRule builds SET for provided fields', async () => {
    mockQuery.mockResolvedValue({
      command: 'UPDATE',
      fields: [],
      oid: 0,
      rowCount: 1,
      rows: [{ ...mockRule, name: 'Updated' }],
    })
    const result = await updateDeductionRule(user, 'rule-1', { enabled: false, name: 'Updated' })
    expect(result?.name).toBe('Updated')
  })

  test('updateDeductionRule returns existing when no fields provided', async () => {
    mockQuery.mockResolvedValue({ command: 'SELECT', fields: [], oid: 0, rowCount: 1, rows: [mockRule] })
    const result = await updateDeductionRule(user, 'rule-1', {})
    expect(result?.name).toBe('Sauna rule')
  })

  test('deleteDeductionRule returns true on success', async () => {
    mockQuery.mockResolvedValue({ command: 'DELETE', fields: [], oid: 0, rowCount: 1, rows: [] })
    expect(await deleteDeductionRule(user, 'rule-1')).toBe(true)
  })

  test('deleteDeductionRule returns false when not found', async () => {
    mockQuery.mockResolvedValue({ command: 'DELETE', fields: [], oid: 0, rowCount: 0, rows: [] })
    expect(await deleteDeductionRule(user, 'nonexistent')).toBe(false)
  })

  test('deleteRuleActivities deletes by rule_id', async () => {
    mockQuery.mockResolvedValue({ command: 'DELETE', fields: [], oid: 0, rowCount: 3, rows: [] })
    expect(await deleteRuleActivities(user, 'rule-1')).toBe(3)
  })

  test('deleteStaleRuleActivities excludes keepIds', async () => {
    mockQuery.mockResolvedValue({ command: 'DELETE', fields: [], oid: 0, rowCount: 1, rows: [] })
    const start = new Date('2024-01-15T00:00:00Z')
    const end = new Date('2024-01-15T23:59:59Z')
    const result = await deleteStaleRuleActivities(user, 'rule-1', start, end, ['id-1', 'id-2'])
    expect(result).toBe(1)
    expect(mockQuery).toHaveBeenCalledWith(user, expect.stringContaining('ALL'), expect.any(Array))
  })

  test('deleteStaleRuleActivities works without keepIds', async () => {
    mockQuery.mockResolvedValue({ command: 'DELETE', fields: [], oid: 0, rowCount: 0, rows: [] })
    const start = new Date('2024-01-15T00:00:00Z')
    const end = new Date('2024-01-15T23:59:59Z')
    await deleteStaleRuleActivities(user, 'rule-1', start, end, [])
    expect(mockQuery).toHaveBeenCalledWith(user, expect.not.stringContaining('ALL'), expect.any(Array))
  })

  test('insertDeductionRuleRun inserts audit record', async () => {
    mockQuery.mockResolvedValue({ command: 'INSERT', fields: [], oid: 0, rowCount: 1, rows: [] })
    await insertDeductionRuleRun(user, {
      activities_created: 5,
      duration_ms: 120,
      rule_id: 'rule-1',
      window_end: new Date('2024-01-15T23:59:59Z'),
      window_start: new Date('2024-01-15T00:00:00Z'),
    })
    expect(mockQuery).toHaveBeenCalled()
  })
})
