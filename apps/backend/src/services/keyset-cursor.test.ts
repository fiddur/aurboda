import { describe, expect, test } from 'vitest'

import { decodeKeysetCursor, encodeKeysetCursor } from './keyset-cursor.ts'

const UUID = '11111111-2222-4333-8444-555555555555'

describe('keyset cursor', () => {
  test('round-trips a (timestamp, id) position', () => {
    const ts = new Date('2026-07-01T08:00:00.123Z')
    const decoded = decodeKeysetCursor(encodeKeysetCursor(ts, UUID))
    expect(decoded).toEqual({ id: UUID, ts })
  })

  test('missing/empty cursor decodes to undefined (first page)', () => {
    expect(decodeKeysetCursor(undefined)).toBeUndefined()
    expect(decodeKeysetCursor('')).toBeUndefined()
  })

  test('malformed cursors decode to undefined instead of reaching the SQL layer', () => {
    expect(decodeKeysetCursor('not base64url!')).toBeUndefined()
    // Valid base64url but no separator / non-UUID id / non-numeric timestamp.
    expect(decodeKeysetCursor(Buffer.from('justonepart').toString('base64url'))).toBeUndefined()
    expect(decodeKeysetCursor(Buffer.from('12345:not-a-uuid').toString('base64url'))).toBeUndefined()
    expect(decodeKeysetCursor(Buffer.from(`NaN:${UUID}`).toString('base64url'))).toBeUndefined()
  })
})
