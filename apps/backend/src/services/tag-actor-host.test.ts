import { describe, expect, it } from 'vitest'

import { DEFAULT_TAG_ACTOR_HOST, readTagActorHost, tagActorHostOrDefault } from './tag-actor-host.ts'

describe('tagActorHostOrDefault', () => {
  it('falls back to tags.pub when unset or empty', () => {
    expect(tagActorHostOrDefault(null)).toBe(DEFAULT_TAG_ACTOR_HOST)
    expect(tagActorHostOrDefault(undefined)).toBe('tags.pub')
    expect(tagActorHostOrDefault('  ')).toBe('tags.pub')
  })

  it('keeps a configured host', () => {
    expect(tagActorHostOrDefault('tags.example')).toBe('tags.example')
  })
})

describe('readTagActorHost', () => {
  it('reads the server setting', async () => {
    const centralDb = { getServerSetting: async () => 'relay.example' } as never
    expect(await readTagActorHost(centralDb)).toBe('relay.example')
  })
})
