import { describe, expect, it } from 'vitest'

import { feedTabFromQuery, feedTabUrl } from './feed-tab'

describe('feedTabFromQuery', () => {
  it('defaults to the people you follow', () => {
    expect(feedTabFromQuery({})).toBe('following')
    expect(feedTabFromQuery({ tab: 'nonsense' })).toBe('following')
  })

  it('reads your own posts from ?tab=mine', () => {
    expect(feedTabFromQuery({ tab: 'mine' })).toBe('mine')
  })
})

describe('feedTabUrl', () => {
  it('sets tab=mine and drops it for the default tab', () => {
    expect(feedTabUrl('/feed', {}, 'mine')).toBe('/feed?tab=mine')
    expect(feedTabUrl('/feed', { tab: 'mine' }, 'following')).toBe('/feed')
  })

  it('keeps the embed flag and other params', () => {
    expect(feedTabUrl('/feed', { embed: '1' }, 'mine')).toBe('/feed?embed=1&tab=mine')
    expect(feedTabUrl('/feed', { embed: '1', tab: 'mine' }, 'following')).toBe('/feed?embed=1')
  })
})
