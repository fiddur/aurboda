import { describe, expect, test } from 'vitest'

import { mergeAttachments } from './attachments-merge'

const a = { id: 'a', name: 'server a' }
const b = { id: 'b', name: 'server b' }
const c = { id: 'c', name: 'local c' }
const d = { id: 'd', name: 'local d' }

describe('mergeAttachments', () => {
  test('keeps an attachment added after the save was sent', () => {
    expect(mergeAttachments([a], [a, c], new Set(['c']))).toEqual([a, c])
  })

  test('does not bring back one the server no longer has and that was not added since', () => {
    expect(mergeAttachments([a], [a, b], new Set())).toEqual([a])
  })

  test('does not bring back one added since but deleted here before the answer', () => {
    expect(mergeAttachments([a], [a], new Set(['c']))).toEqual([a])
  })

  test('lists each attachment once, as the server has it', () => {
    const fresh = { id: 'c', name: 'server c' }
    expect(mergeAttachments([a, fresh], [a, c], new Set(['c']))).toEqual([a, fresh])
  })

  test('answers the server’s order, then the kept local ones in theirs', () => {
    expect(mergeAttachments([b, a], [d, a, c, b], new Set(['c', 'd']))).toEqual([b, a, d, c])
  })
})
