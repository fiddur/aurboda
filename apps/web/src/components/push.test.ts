import type { PushSubscription } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  derivePushState,
  disablePush,
  dropUnknownSubscription,
  enablePush,
  needsHomeScreen,
  parsePushPayload,
  type PushBrowser,
  type PushStateInput,
  pushTargetUrl,
  shouldOfferPush,
  takeNotificationRead,
  toSubscriptionBody,
  urlBase64ToUint8Array,
} from './push'

const ID = '11111111-1111-4111-8111-111111111111'
const ORIGIN = 'https://aurboda.example'
const ENDPOINT = 'https://push.example/send/abc'

const ready: PushStateInput = {
  embedded: false,
  needsHomeScreen: false,
  permission: 'default',
  serverEnabled: true,
  subscribed: false,
  supported: true,
}

describe('derivePushState', () => {
  it.each<[string, Partial<PushStateInput>, string]>([
    ['embedded in the app', { embedded: true }, 'hidden'],
    ['server without push', { serverEnabled: false }, 'hidden'],
    ['server answer pending', { serverEnabled: undefined }, 'loading'],
    ['iPhone outside a home-screen app', { needsHomeScreen: true, supported: false }, 'needs_home_screen'],
    ['no Push API', { permission: 'unsupported', supported: false }, 'unsupported'],
    ['notifications denied', { permission: 'denied', subscribed: true }, 'blocked'],
    ['subscription pending', { subscribed: undefined }, 'loading'],
    ['not subscribed', {}, 'off'],
    ['subscribed', { permission: 'granted', subscribed: true }, 'on'],
  ])('%s', (_label, input, state) => expect(derivePushState({ ...ready, ...input })).toBe(state))
})

describe('shouldOfferPush', () => {
  it('offers where the user can act, until dismissed', () => {
    expect(shouldOfferPush('off', false)).toBe(true)
    expect(shouldOfferPush('needs_home_screen', false)).toBe(true)
    expect(shouldOfferPush('off', true)).toBe(false)
    for (const state of ['on', 'blocked', 'unsupported', 'hidden', 'loading'] as const) {
      expect(shouldOfferPush(state, false)).toBe(false)
    }
  })
})

describe('needsHomeScreen', () => {
  const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Safari/604.1'
  const mac =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15'
  it('is an iPhone or iPad browser that is not an installed web app', () => {
    expect(needsHomeScreen(iphone, 5, false)).toBe(true)
    expect(needsHomeScreen(iphone, 5, true)).toBe(false)
    expect(needsHomeScreen(mac, 5, false)).toBe(true)
    expect(needsHomeScreen(mac, 0, false)).toBe(false)
  })
})

describe('parsePushPayload', () => {
  it('reads an Aurboda payload', () => {
    expect(parsePushPayload({ body: 'b', id: ID, link: '/x', title: 't', type: 'reminder' })).toEqual({
      body: 'b',
      id: ID,
      link: '/x',
      title: 't',
      type: 'reminder',
    })
  })

  it('tolerates missing optional fields and refuses anything else', () => {
    expect(parsePushPayload({ id: ID, title: 't' })).toEqual({
      body: null,
      id: ID,
      link: null,
      title: 't',
      type: '',
    })
    expect(parsePushPayload(null)).toBeNull()
    expect(parsePushPayload('text')).toBeNull()
    expect(parsePushPayload({ title: 't' })).toBeNull()
  })
})

describe('pushTargetUrl', () => {
  it('opens the in-app link with the notification to mark read', () => {
    expect(pushTargetUrl('/reminders?x=1#top', ID, ORIGIN)).toBe(
      `${ORIGIN}/reminders?x=1&notification_read=${ID}#top`,
    )
  })

  it('falls back to the notifications page without a usable link', () => {
    expect(pushTargetUrl(null, ID, ORIGIN)).toBe(`${ORIGIN}/notifications?notification_read=${ID}`)
    expect(pushTargetUrl('https://evil.example/x', ID, ORIGIN)).toBe(
      `${ORIGIN}/notifications?notification_read=${ID}`,
    )
    expect(pushTargetUrl('//evil.example/x', ID, ORIGIN)).toBe(
      `${ORIGIN}/notifications?notification_read=${ID}`,
    )
  })

  it('marks nothing read for a push that is not a stored notification', () => {
    expect(pushTargetUrl('/settings#notifications', 'test', ORIGIN)).toBe(`${ORIGIN}/settings#notifications`)
  })
})

describe('takeNotificationRead', () => {
  it('takes the id and gives the address without it', () => {
    expect(takeNotificationRead(`${ORIGIN}/reminders?x=1&notification_read=${ID}#top`)).toEqual({
      cleaned: '/reminders?x=1#top',
      id: ID,
    })
  })

  it('is null without the parameter, and drops one that is not an id', () => {
    expect(takeNotificationRead(`${ORIGIN}/reminders`)).toBeNull()
    expect(takeNotificationRead(`${ORIGIN}/x?notification_read=nope`)).toEqual({ cleaned: '/x', id: '' })
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodes URL-safe base64 without padding', () => {
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255])
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3])
  })
})

describe('toSubscriptionBody', () => {
  it('keeps the endpoint and keys', () => {
    expect(
      toSubscriptionBody({ endpoint: ENDPOINT, expirationTime: null, keys: { auth: 'a', p256dh: 'p' } }),
    ).toEqual({ endpoint: ENDPOINT, keys: { auth: 'a', p256dh: 'p' } })
  })

  it('refuses an incomplete subscription', () => {
    expect(() => toSubscriptionBody({ endpoint: ENDPOINT })).toThrow()
  })
})

const fakeBrowser = (overrides: Partial<PushBrowser> = {}) => {
  const calls: string[] = []
  const browser: PushBrowser = {
    endpoint: async () => ENDPOINT,
    needsHomeScreen: false,
    permission: () => 'default',
    requestPermission: async () => 'granted',
    subscribe: async (key) => {
      calls.push(`subscribe ${key}`)
      return { endpoint: ENDPOINT, keys: { auth: 'a', p256dh: 'p' } }
    },
    supported: true,
    unsubscribe: async () => {
      calls.push('unsubscribe')
      return ENDPOINT
    },
    ...overrides,
  }
  return { browser, calls }
}

const subscription = (id: string, current: boolean): PushSubscription => ({
  browser: 'Firefox on Linux',
  created_at: '2026-11-01T10:00:00.000Z',
  current,
  id,
  last_success_at: null,
})

const fakeApi = (listed: PushSubscription[] = []) => {
  const calls: unknown[] = []
  return {
    api: {
      add: async (body: unknown) => calls.push(['add', body]),
      list: async (endpoint: string) => {
        calls.push(['list', endpoint])
        return listed
      },
      remove: async (id: string) => calls.push(['remove', id]),
    },
    calls,
  }
}

describe('enablePush', () => {
  it('subscribes with the server key and stores the subscription', async () => {
    const { browser, calls } = fakeBrowser({ endpoint: async () => null })
    const { api, calls: apiCalls } = fakeApi()
    expect(await enablePush(browser, api, 'KEY')).toBe('on')
    expect(calls).toEqual(['subscribe KEY'])
    expect(apiCalls).toEqual([['add', { endpoint: ENDPOINT, keys: { auth: 'a', p256dh: 'p' } }]])
  })

  it('keeps a subscription this account already has', async () => {
    const { browser, calls } = fakeBrowser()
    const { api } = fakeApi([subscription('mine', true)])
    expect(await enablePush(browser, api, 'KEY')).toBe('on')
    expect(calls).toEqual(['subscribe KEY'])
  })

  it('replaces a subscription another account left in this browser', async () => {
    const { browser, calls } = fakeBrowser()
    const { api } = fakeApi([subscription('other', false)])
    expect(await enablePush(browser, api, 'KEY')).toBe('on')
    expect(calls).toEqual(['unsubscribe', 'subscribe KEY'])
  })

  it('ends blocked when permission is denied, off when the prompt is dismissed', async () => {
    const { api, calls } = fakeApi()
    expect(await enablePush(fakeBrowser({ requestPermission: async () => 'denied' }).browser, api, 'K')).toBe(
      'blocked',
    )
    expect(
      await enablePush(fakeBrowser({ requestPermission: async () => 'default' }).browser, api, 'K'),
    ).toBe('off')
    expect(calls).toEqual([])
  })
})

describe('dropUnknownSubscription', () => {
  it('drops a subscription the signed-in account does not list', async () => {
    const { browser, calls } = fakeBrowser()
    expect(await dropUnknownSubscription(browser, fakeApi([subscription('other', false)]).api)).toBe(true)
    expect(calls).toEqual(['unsubscribe'])
  })

  it("keeps the account's own subscription", async () => {
    const { browser, calls } = fakeBrowser()
    expect(await dropUnknownSubscription(browser, fakeApi([subscription('mine', true)]).api)).toBe(false)
    expect(calls).toEqual([])
  })

  it('asks the server nothing without a subscription in this browser', async () => {
    const { api, calls: apiCalls } = fakeApi()
    expect(await dropUnknownSubscription(fakeBrowser({ endpoint: async () => null }).browser, api)).toBe(
      false,
    )
    expect(apiCalls).toEqual([])
  })

  it('leaves a subscription that changed while the server was asked', async () => {
    const endpoints = [ENDPOINT, `${ENDPOINT}-new`]
    const { browser, calls } = fakeBrowser({ endpoint: async () => endpoints.shift() ?? null })
    expect(await dropUnknownSubscription(browser, fakeApi().api)).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('disablePush', () => {
  it('removes this browser from the server, then unsubscribes', async () => {
    const { browser, calls } = fakeBrowser()
    const { api, calls: apiCalls } = fakeApi([subscription('other', false), subscription('mine', true)])
    await disablePush(browser, api)
    expect(apiCalls).toEqual([
      ['list', ENDPOINT],
      ['remove', 'mine'],
    ])
    expect(calls).toEqual(['unsubscribe'])
  })

  it('touches no server row without a subscription in this browser', async () => {
    const { browser, calls } = fakeBrowser({ endpoint: async () => null })
    const { api, calls: apiCalls } = fakeApi()
    await disablePush(browser, api)
    expect(apiCalls).toEqual([])
    expect(calls).toEqual(['unsubscribe'])
  })
})
