import { describe, expect, test } from 'vitest'

import { confirmsUsername } from './delete-account'

describe('confirmsUsername', () => {
  test('accepts the exact username, ignoring surrounding spaces', () => {
    expect(confirmsUsername('alice', 'alice')).toBe(true)
    expect(confirmsUsername(' alice ', 'alice')).toBe(true)
  })

  test('refuses anything else', () => {
    expect(confirmsUsername('', 'alice')).toBe(false)
    expect(confirmsUsername('Alice', 'alice')).toBe(false)
    expect(confirmsUsername('alic', 'alice')).toBe(false)
    expect(confirmsUsername('', '')).toBe(false)
  })
})
