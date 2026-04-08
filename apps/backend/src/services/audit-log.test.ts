import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import { auditError, auditInfo, auditLog, auditWarn, getAuditLog, pruneAuditLog } from './audit-log.ts'

vi.mock('../db', () => ({
  cleanupAuditLog: vi.fn(),
  insertAuditLog: vi.fn(),
  queryAuditLog: vi.fn(),
}))

describe('auditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('inserts audit log entry', async () => {
    vi.mocked(db.insertAuditLog).mockResolvedValue(undefined)

    await auditLog('testuser', 'info', 'sync', 'Oura sync completed', { records: 42 })

    expect(db.insertAuditLog).toHaveBeenCalledWith('testuser', 'info', 'sync', 'Oura sync completed', {
      records: 42,
    })
  })

  test('inserts without details', async () => {
    vi.mocked(db.insertAuditLog).mockResolvedValue(undefined)

    await auditLog('testuser', 'warn', 'data', 'Something happened')

    expect(db.insertAuditLog).toHaveBeenCalledWith(
      'testuser',
      'warn',
      'data',
      'Something happened',
      undefined,
    )
  })

  test('swallows errors and logs to stderr', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(db.insertAuditLog).mockRejectedValue(new Error('DB connection failed'))

    await auditLog('testuser', 'error', 'sync', 'Bad thing')

    expect(consoleSpy).toHaveBeenCalledWith('⚠️ Failed to write audit log for testuser:', expect.any(Error))
    consoleSpy.mockRestore()
  })
})

describe('convenience loggers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.insertAuditLog).mockResolvedValue(undefined)
  })

  test('auditInfo passes level=info', async () => {
    await auditInfo('testuser', 'sync', 'Sync done')
    expect(db.insertAuditLog).toHaveBeenCalledWith('testuser', 'info', 'sync', 'Sync done', undefined)
  })

  test('auditWarn passes level=warn', async () => {
    await auditWarn('testuser', 'data', 'Rate limited', { retry_after: 60 })
    expect(db.insertAuditLog).toHaveBeenCalledWith('testuser', 'warn', 'data', 'Rate limited', {
      retry_after: 60,
    })
  })

  test('auditError passes level=error', async () => {
    await auditError('testuser', 'sync', 'Sync failed')
    expect(db.insertAuditLog).toHaveBeenCalledWith('testuser', 'error', 'sync', 'Sync failed', undefined)
  })
})

describe('getAuditLog', () => {
  test('delegates to queryAuditLog with params', async () => {
    const mockRows = [{ id: '1', level: 'info', message: 'test' }]
    vi.mocked(db.queryAuditLog).mockResolvedValue(mockRows as never)

    const result = await getAuditLog('testuser', { category: 'sync', limit: 10 })

    expect(db.queryAuditLog).toHaveBeenCalledWith('testuser', { category: 'sync', limit: 10 })
    expect(result).toBe(mockRows)
  })

  test('uses empty params by default', async () => {
    vi.mocked(db.queryAuditLog).mockResolvedValue([] as never)

    await getAuditLog('testuser')

    expect(db.queryAuditLog).toHaveBeenCalledWith('testuser', {})
  })
})

describe('pruneAuditLog', () => {
  test('delegates to cleanupAuditLog', async () => {
    vi.mocked(db.cleanupAuditLog).mockResolvedValue(5)

    const result = await pruneAuditLog('testuser', 30)

    expect(db.cleanupAuditLog).toHaveBeenCalledWith('testuser', 30)
    expect(result).toBe(5)
  })
})
