import { describe, expect, test } from 'vitest'

import { attachmentChangesSince, mergeAttachments } from './attachments-merge'

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

  test('leaves out one removed here after the save was sent, though the answer still lists it', () => {
    expect(mergeAttachments([a, b], [a], new Set(), new Set(['b']))).toEqual([a])
  })

  test('keeps one whose removal was undone after the save was sent', () => {
    const { addedSince, removedSince } = attachmentChangesSince([
      { id: 'b', kind: 'removed' },
      { id: 'b', kind: 'added' },
    ])
    expect(mergeAttachments([a], [a, b], addedSince, removedSince)).toEqual([a, b])
    expect(mergeAttachments([a, b], [a, b], addedSince, removedSince)).toEqual([a, b])
  })
})

describe('attachmentChangesSince', () => {
  test('the later change to an id wins', () => {
    const { addedSince, removedSince } = attachmentChangesSince([
      { id: 'a', kind: 'added' },
      { id: 'b', kind: 'removed' },
      { id: 'b', kind: 'added' },
      { id: 'a', kind: 'removed' },
      { id: 'c', kind: 'added' },
    ])
    expect([...addedSince].sort()).toEqual(['b', 'c'])
    expect([...removedSince]).toEqual(['a'])
  })

  test('nothing changed, nothing to merge in', () => {
    const { addedSince, removedSince } = attachmentChangesSince([])
    expect(addedSince.size + removedSince.size).toBe(0)
  })
})
