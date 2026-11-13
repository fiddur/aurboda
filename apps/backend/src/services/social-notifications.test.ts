import { describe, expect, test } from 'vitest'

import {
  actorLabel,
  followAcceptedNotification,
  htmlSnippet,
  inboundFollowNotification,
  reactionNotification,
  type TimelineEntryEvent,
  timelineEntryNotification,
  textSnippet,
} from './social-notifications.ts'

const ALICE = {
  actor_uri: 'https://m.example/users/alice',
  display_name: 'Alice',
  handle: '@alice@m.example',
}
const BOB = { actor_uri: 'https://m.example/users/bob', display_name: null, handle: '@bob@m.example' }
const PREFIX = 'https://aurboda.example/users/me/feed/'
const POST_ID = '7d0c7b8e-4b0e-4c55-9f3f-6a1f2a1b2c3d'
const NOTE = 'https://m.example/users/alice/statuses/1'

describe('actorLabel', () => {
  test('prefers the display name, then the handle, then the actor uri', () => {
    expect(actorLabel(ALICE)).toBe('Alice')
    expect(actorLabel(BOB)).toBe('@bob@m.example')
    expect(actorLabel({ actor_uri: 'https://x.example/u', display_name: ' ', handle: null })).toBe(
      'https://x.example/u',
    )
  })
})

describe('snippets', () => {
  test('htmlSnippet strips tags, decodes entities and collapses whitespace', () => {
    expect(htmlSnippet('<p>Hi &amp; <a href="x">you</a></p><p>there&#39;s&nbsp;more</p>')).toBe(
      "Hi & you there's more",
    )
  })

  test('cuts long text at a word boundary with an ellipsis', () => {
    const snippet = textSnippet('word '.repeat(60))
    expect(snippet.length).toBeLessThanOrEqual(141)
    expect(snippet.endsWith('word…')).toBe(true)
  })
})

describe('inboundFollowNotification', () => {
  const base = { actor: ALICE, follow_activity_uri: 'https://m.example/follows/1' }

  test('a first request in manual-approval mode is a follow request', () => {
    expect(inboundFollowNotification({ ...base, accepted: false, existing: null })).toEqual({
      body: '@alice@m.example',
      data: { actor_uri: ALICE.actor_uri },
      dedupe_key: 'feed_follow_request:https://m.example/follows/1',
      link: '/feed',
      title: 'Alice wants to follow you',
      type: 'feed_follow_request',
    })
  })

  test('a repeated pending request raises nothing', () => {
    expect(inboundFollowNotification({ ...base, accepted: false, existing: { accepted: false } })).toBeNull()
  })

  test('an accepted follow is a new follower, keyed on the actor without an activity id', () => {
    expect(
      inboundFollowNotification({ accepted: true, actor: BOB, existing: null, follow_activity_uri: null }),
    ).toEqual({
      body: undefined,
      data: { actor_uri: BOB.actor_uri },
      dedupe_key: `feed_new_follower:${BOB.actor_uri}`,
      link: '/feed',
      title: '@bob@m.example started following you',
      type: 'feed_new_follower',
    })
    expect(inboundFollowNotification({ ...base, accepted: true, existing: { accepted: false } })?.type).toBe(
      'feed_new_follower',
    )
  })

  test('a re-follow by an accepted follower raises nothing', () => {
    expect(inboundFollowNotification({ ...base, accepted: true, existing: { accepted: true } })).toBeNull()
  })
})

describe('followAcceptedNotification', () => {
  const now = new Date('2026-11-13T12:00:00Z')

  test('an instant accept is not news', () => {
    expect(followAcceptedNotification(ALICE, new Date('2026-11-13T11:56:00Z'), now)).toBeNull()
  })

  test('an accept after a wait is', () => {
    expect(followAcceptedNotification(ALICE, new Date('2026-11-13T11:00:00Z'), now)).toEqual({
      data: { actor_uri: ALICE.actor_uri },
      dedupe_key: `feed_follow_accepted:${ALICE.actor_uri}:2026-11-13T11:00:00.000Z`,
      link: '/feed',
      title: 'Alice accepted your follow request',
      type: 'feed_follow_accepted',
    })
  })
})

describe('reactionNotification', () => {
  test('a like links to the post and quotes its message', () => {
    expect(reactionNotification('like', ALICE, 'me', { id: POST_ID, message: 'Long run  today' })).toEqual({
      body: 'Long run today',
      data: { actor_uri: ALICE.actor_uri, post_id: POST_ID },
      dedupe_key: `feed_like:${POST_ID}:${ALICE.actor_uri}`,
      link: `/u/me/posts/${POST_ID}`,
      title: 'Alice liked your post',
      type: 'feed_like',
    })
  })

  test('a boost of a post without a message has no body', () => {
    const notification = reactionNotification('announce', BOB, 'me', { id: POST_ID, message: null })
    expect(notification).toMatchObject({
      dedupe_key: `feed_boost:${POST_ID}:${BOB.actor_uri}`,
      title: '@bob@m.example boosted your post',
      type: 'feed_boost',
    })
    expect(notification.body).toBeUndefined()
  })
})

describe('timelineEntryNotification', () => {
  const event = (
    over: Partial<Omit<TimelineEntryEvent, 'entry'>> & { entry?: Partial<TimelineEntryEvent['entry']> } = {},
  ): TimelineEntryEvent => {
    const { entry, ...rest } = over
    return {
      me: 'me',
      own_object_prefix: PREFIX,
      source: { notify_on_post: true, tag: null },
      visible: true,
      ...rest,
      entry: {
        actor_uri: ALICE.actor_uri,
        content: '<p>Hello</p>',
        display_name: ALICE.display_name,
        handle: ALICE.handle,
        object_uri: NOTE,
        ...entry,
      },
    }
  }

  test('a top-level post from a followee whose bell is on', () => {
    expect(timelineEntryNotification(event())).toEqual({
      body: 'Hello',
      data: { actor_uri: ALICE.actor_uri, object_uri: NOTE },
      dedupe_key: `feed_post:${NOTE}`,
      link: '/feed',
      title: 'Alice posted',
      type: 'feed_post',
    })
  })

  test('no post notification with the bell off, for a tag follow, a stranger, or a hidden entry', () => {
    expect(timelineEntryNotification(event({ source: { notify_on_post: false, tag: null } }))).toBeNull()
    expect(timelineEntryNotification(event({ source: { notify_on_post: true, tag: 'running' } }))).toBeNull()
    expect(timelineEntryNotification(event({ source: null }))).toBeNull()
    expect(timelineEntryNotification(event({ visible: false }))).toBeNull()
  })

  test('a reply to someone else is not a post notification', () => {
    expect(
      timelineEntryNotification(event({ entry: { in_reply_to_uri: 'https://x.example/notes/1' } })),
    ).toBeNull()
  })

  test('a reply to my post notifies whatever the bell and visibility, linking to my post', () => {
    expect(
      timelineEntryNotification(
        event({
          entry: { in_reply_to_uri: `${PREFIX}${POST_ID}`, mentions_me: true },
          source: { notify_on_post: false, tag: null },
          visible: false,
        }),
      ),
    ).toEqual({
      body: 'Hello',
      data: { actor_uri: ALICE.actor_uri, object_uri: NOTE },
      dedupe_key: `feed_reply:${NOTE}`,
      link: `/u/me/posts/${POST_ID}`,
      title: 'Alice replied to your post',
      type: 'feed_reply',
    })
  })

  test('a mention notifies, from a stranger too', () => {
    expect(timelineEntryNotification(event({ entry: { mentions_me: true }, source: null }))).toMatchObject({
      dedupe_key: `feed_mention:${NOTE}`,
      link: '/feed',
      title: 'Alice mentioned you',
      type: 'feed_mention',
    })
  })

  test('a boost card names the booster and the author, even of a reply', () => {
    const announce = 'https://m.example/users/bob/statuses/9/activity'
    expect(
      timelineEntryNotification(
        event({
          entry: {
            boost_of_uri: NOTE,
            boosted_by_actor_uri: BOB.actor_uri,
            boosted_by_display_name: null,
            boosted_by_handle: BOB.handle,
            in_reply_to_uri: `${PREFIX}${POST_ID}`,
            object_uri: announce,
          },
        }),
      ),
    ).toMatchObject({
      dedupe_key: `feed_post:${announce}`,
      title: '@bob@m.example boosted Alice',
      type: 'feed_post',
    })
  })

  test('a boost card from a muted booster raises nothing', () => {
    expect(
      timelineEntryNotification(
        event({
          entry: { boost_of_uri: NOTE, boosted_by_actor_uri: BOB.actor_uri, object_uri: 'https://a/1' },
          source: { notify_on_post: false, tag: null },
        }),
      ),
    ).toBeNull()
  })
})
