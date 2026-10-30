import { describe, expect, test } from 'vitest'

import { newId, uuidFrom } from './uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuidFrom', () => {
  test('uses randomUUID when the context has it', () => {
    expect(
      uuidFrom({ getRandomValues: crypto.getRandomValues.bind(crypto), randomUUID: () => 'native' }),
    ).toBe('native')
  })

  test('builds a v4 UUID from getRandomValues on an insecure origin', () => {
    const id = uuidFrom({ getRandomValues: crypto.getRandomValues.bind(crypto) })
    expect(id).toMatch(V4)
  })

  test('sets the version and variant bits whatever the random bytes are', () => {
    const fill = (value: number) => ({
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint8Array) array.fill(value)
        return array
      },
    })
    expect(uuidFrom(fill(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    expect(uuidFrom(fill(0x00))).toBe('00000000-0000-4000-8000-000000000000')
  })
})

test('newId returns a v4 UUID', () => {
  expect(newId()).toMatch(V4)
})
