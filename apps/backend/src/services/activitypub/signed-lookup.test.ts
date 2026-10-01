import type { Context } from '@fedify/fedify'

import { describe, expect, test, vi } from 'vitest'

import { signedFetchOptions } from './signed-lookup.ts'

const loader = async () => ({ contextUrl: null, document: {}, documentUrl: '' })
const ctxWith = (getDocumentLoader: unknown) =>
  ({ getDocumentLoader }) as unknown as Pick<Context<void>, 'getDocumentLoader'>

describe('signedFetchOptions', () => {
  test('signs as the given local user', async () => {
    const getDocumentLoader = vi.fn(async () => loader)
    expect(await signedFetchOptions(ctxWith(getDocumentLoader), 'bob')).toEqual({ documentLoader: loader })
    expect(getDocumentLoader).toHaveBeenCalledWith({ identifier: 'bob' })
  })

  test('stays unsigned when there is no local user to sign as', async () => {
    const getDocumentLoader = vi.fn(async () => loader)
    expect(await signedFetchOptions(ctxWith(getDocumentLoader), null)).toEqual({})
    expect(getDocumentLoader).not.toHaveBeenCalled()
  })

  test('falls back to unsigned when the user’s key can’t be loaded', async () => {
    const getDocumentLoader = vi.fn(async () => {
      throw new Error('no key pair')
    })
    expect(await signedFetchOptions(ctxWith(getDocumentLoader), 'bob')).toEqual({})
  })
})
