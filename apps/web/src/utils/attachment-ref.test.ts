import { describe, expect, it } from 'vitest'

import { attachmentIdOf } from './attachment-ref'

describe('attachmentIdOf', () => {
  const id = '3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c'

  it('reads the id of an attachment: URL, lower-cased', () => {
    expect(attachmentIdOf(`attachment:${id}`)).toBe(id)
    expect(attachmentIdOf(`ATTACHMENT:${id.toUpperCase()}`)).toBe(id)
  })

  it('answers undefined for anything else', () => {
    expect(attachmentIdOf('attachment:nope')).toBeUndefined()
    expect(attachmentIdOf(`https://example.com/${id}`)).toBeUndefined()
    expect(attachmentIdOf(`attachment:${id}/x`)).toBeUndefined()
  })
})
