import { describe, expect, test, vi } from 'vitest'

import { createLocalBoostCardHolders } from './local-card-holders.ts'

const NOTE = 'https://aurboda.example/users/bob/feed/1'
const BOB = 'https://aurboda.example/users/bob'

describe('createLocalBoostCardHolders', () => {
  test('lists the users that hold a card, asking one user at a time', async () => {
    let inFlight = 0
    const holds = vi.fn(async (user: string) => {
      inFlight++
      expect(inFlight).toBe(1)
      await Promise.resolve()
      inFlight--
      return user !== 'carol'
    })
    const list = createLocalBoostCardHolders({ holds, listUsers: async () => ['alice', 'carol', 'dave'] })
    expect(await list(NOTE, BOB)).toEqual(['alice', 'dave'])
    expect(holds).toHaveBeenCalledWith('alice', NOTE, BOB)
  })

  test('a missing or failing database skips that user only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const missing = Object.assign(new Error('no db'), { code: '3D000' })
    const holds = async (user: string) => {
      if (user === 'gone') throw missing
      if (user === 'broken') throw new Error('pool down')
      return true
    }
    const list = createLocalBoostCardHolders({ holds, listUsers: async () => ['gone', 'broken', 'alice'] })
    expect(await list(NOTE, BOB)).toEqual(['alice'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('broken'), expect.any(Error))
    warn.mockRestore()
  })
})
