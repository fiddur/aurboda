import { describe, expect, test, vi } from 'vitest'

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

describe('summarizeAuditBody early-out', () => {
  test.each([
    ['2049 tiny items', { values: Array.from({ length: 2049 }, () => 0) }, { values: { count: 2049 } }],
    ['a 4097-char string', { text: 'x'.repeat(4097) }, { text: `${'x'.repeat(200)}…` }],
  ])('skips stringifying for %s, with the summary the full check gives', (_label, body, summary) => {
    expect(JSON.stringify(body).length).toBeGreaterThan(4096)

    const spy = vi.spyOn(JSON, 'stringify')
    const result = summarizeAuditBody(body)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()

    expect(result).toEqual({ ...summary, _truncated: true })
  })

  test('the bounds are tight: 2048 tiny items and a 4096-char string still go through the full check', () => {
    expect(summarizeAuditBody({ values: Array.from({ length: 2048 }, () => 0) })).toEqual({
      _truncated: true,
      values: { count: 2048 },
    })
    expect(summarizeAuditBody({ text: 'x'.repeat(4096) })).toEqual({
      _truncated: true,
      text: `${'x'.repeat(200)}…`,
    })
  })

  test('keeps a small body whose array is long but tiny', () => {
    const body = { values: Array.from({ length: 201 }, () => 0) }
    expect(summarizeAuditBody(body)).toEqual(body)
  })
})
