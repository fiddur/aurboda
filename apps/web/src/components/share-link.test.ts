import { describe, expect, test } from 'vitest'

import { canNativeShare, canWriteClipboard, isAbortError } from './share-link'

describe('canNativeShare', () => {
  test('is true only when navigator.share is a function', () => {
    expect(canNativeShare({ share: () => Promise.resolve() })).toBe(true)
    expect(canNativeShare({})).toBe(false)
    expect(canNativeShare({ share: 'nope' })).toBe(false)
    expect(canNativeShare(undefined)).toBe(false)
  })
})

describe('canWriteClipboard', () => {
  test('is true only when navigator.clipboard.writeText is a function', () => {
    expect(canWriteClipboard({ clipboard: { writeText: () => Promise.resolve() } })).toBe(true)
    expect(canWriteClipboard({ clipboard: {} })).toBe(false)
    expect(canWriteClipboard({})).toBe(false)
    expect(canWriteClipboard(undefined)).toBe(false)
  })
})

describe('isAbortError', () => {
  test('recognises a cancelled share sheet', () => {
    const abort = new Error('cancelled')
    abort.name = 'AbortError'
    expect(isAbortError(abort)).toBe(true)
    expect(isAbortError(new Error('boom'))).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })
})
