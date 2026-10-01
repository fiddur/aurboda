import { describe, expect, test } from 'vitest'

import { summarizeAuditBody } from './audit-body.ts'

describe('summarizeAuditBody', () => {
  test('returns undefined for non-object bodies', () => {
    expect(summarizeAuditBody(undefined)).toBeUndefined()
    expect(summarizeAuditBody(null)).toBeUndefined()
    expect(summarizeAuditBody('text')).toBeUndefined()
    expect(summarizeAuditBody(42)).toBeUndefined()
  })

  test('keeps a small body unchanged', () => {
    const body = { nested: { a: 1 }, tag: 'coffee', values: [1, 2, 3] }
    expect(summarizeAuditBody(body)).toEqual(body)
  })

  test('redacts password in a small body', () => {
    expect(summarizeAuditBody({ password: 'secret', username: 'u' })).toEqual({
      password: '[REDACTED]',
      username: 'u',
    })
  })

  test('summarizes a large sync-like body', () => {
    const records = Array.from({ length: 5000 }, (_, i) => ({ time: i, value: 60 }))
    expect(summarizeAuditBody({ records, type: 'heart_rate' })).toEqual({
      _truncated: true,
      records: { count: 5000 },
      type: 'heart_rate',
    })
  })

  test('redacts password in a large body', () => {
    const result = summarizeAuditBody({ blob: 'x'.repeat(5000), password: 'secret' })
    expect(result?.password).toBe('[REDACTED]')
    expect(result?._truncated).toBe(true)
  })

  test('truncates long strings and counts nested object keys in a large body', () => {
    const result = summarizeAuditBody({
      flag: true,
      meta: { a: 1, b: 2 },
      n: 3,
      nothing: null,
      text: 'y'.repeat(5000),
    })
    expect(result).toEqual({
      _truncated: true,
      flag: true,
      meta: { keys: 2 },
      n: 3,
      nothing: null,
      text: `${'y'.repeat(200)}…`,
    })
  })

  test('reduces an array body to its length', () => {
    expect(summarizeAuditBody([1, 2, 3])).toEqual({ items: 3 })
  })
})
