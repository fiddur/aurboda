import { describe, expect, test, vi } from 'vitest'

import type { FeedPostRecord } from '../db/feed.ts'

import { describePost, postEyebrow, resolvePostWith } from './post-card.ts'

const POST_ID = '11111111-2222-4333-8444-555555555555'
const ACTIVITY_ID = '66666666-2222-4333-8444-555555555555'

const record = (overrides: Partial<FeedPostRecord> = {}): FeedPostRecord => ({
  activity_id: null,
  article: null,
  autoshare_rule_id: null,
  challenge: null,
  created_at: new Date('2026-11-01T07:30:00.000Z'),
  dashboard: null,
  exercise: null,
  id: POST_ID,
  image_token: 'token',
  in_reply_to_actor_uri: null,
  in_reply_to_handle: null,
  in_reply_to_uri: null,
  include_chart: false,
  include_exercises: false,
  include_map: false,
  included_metrics: [],
  kind: 'reply',
  message: null,
  series_metrics: [],
  tags: [],
  updated_at: new Date('2026-11-01T08:00:00.000Z'),
  visibility: 'public',
  ...overrides,
})

describe('describePost', () => {
  test('an article: its title and first prose block', () => {
    expect(
      describePost(
        'fiddur',
        record({
          article: {
            blocks: [
              { metric: 'hrv', type: 'chart' } as never,
              { markdown: 'Two **weeks** of sleep.', type: 'prose' },
              { markdown: 'Later prose.', type: 'prose' },
            ],
            title: 'Sleep & HRV',
          },
          kind: 'article',
        }),
      ),
    ).toEqual({ description: 'Two weeks of sleep.', title: 'Sleep & HRV' })
  })

  test('an article without prose has an empty description', () => {
    expect(
      describePost('fiddur', record({ article: { blocks: [], title: 'Charts only' }, kind: 'article' })),
    ).toEqual({ description: '', title: 'Charts only' })
  })

  test("an activity: the activity's headline and the personal message on one line", () => {
    expect(
      describePost('fiddur', record({ kind: 'activity', message: 'Felt  great\ntoday' }), 'Morning run'),
    ).toEqual({ description: 'Felt great today', title: 'Morning run' })
  })

  test('an activity without a message has an empty description', () => {
    expect(describePost('fiddur', record({ kind: 'activity' }), 'Running activity')).toEqual({
      description: '',
      title: 'Running activity',
    })
  })

  test('an activity that is gone falls back to its author', () => {
    expect(describePost('fiddur', record({ kind: 'activity' }), null).title).toBe('Post by fiddur')
  })

  test('exercise, dashboard and challenge posts take their shared name', () => {
    expect(
      describePost(
        'fiddur',
        record({
          exercise: {
            activity_type: 'strength_training',
            field: 'sets.exercise',
            include_records: true,
            include_sessions: false,
            name: 'Bench',
            value: 'Bench Press',
          },
          kind: 'exercise',
        }),
      ),
    ).toEqual({ description: '', title: 'Bench' })
    expect(
      describePost(
        'fiddur',
        record({
          dashboard: { name: 'Month in data' } as FeedPostRecord['dashboard'],
          kind: 'dashboard',
          message: 'October!',
        }),
      ),
    ).toEqual({ description: 'October!', title: 'Month in data' })
    expect(
      describePost(
        'fiddur',
        record({
          challenge: { name: 'Step count', url: 'https://x.test/u/fiddur/steps' },
          kind: 'challenge',
        }),
      ),
    ).toEqual({ description: '', title: 'Step count' })
  })

  test("a reply: the message's first line as its title, clamped", () => {
    expect(describePost('fiddur', record({ message: 'Nice run!\nSee you Sunday.' }))).toEqual({
      description: 'Nice run! See you Sunday.',
      title: 'Nice run!',
    })
    const long = describePost('fiddur', record({ message: 'word '.repeat(40) }))
    expect(long.title.endsWith('…')).toBe(true)
    expect(long.title.length).toBeLessThanOrEqual(80)
  })

  test('a reply without a message falls back to its author', () => {
    expect(describePost('fiddur', record())).toEqual({ description: '', title: 'Post by fiddur' })
  })
})

describe('postEyebrow', () => {
  test('names the kind, and a reply is a post', () => {
    expect(postEyebrow('activity')).toBe('Activity')
    expect(postEyebrow('article')).toBe('Article')
    expect(postEyebrow('exercise')).toBe('Exercise')
    expect(postEyebrow('dashboard')).toBe('Dashboard')
    expect(postEyebrow('challenge')).toBe('Challenge')
    expect(postEyebrow('reply')).toBe('Post')
  })
})

describe('resolvePostWith', () => {
  const activityPost = (overrides: Partial<FeedPostRecord> = {}) =>
    record({ activity_id: ACTIVITY_ID, kind: 'activity', message: 'Felt great', ...overrides })

  const setup = (found: FeedPostRecord | null, headline: () => Promise<string | null>) => {
    const getRecord = vi.fn(async () => found)
    const getActivityHeadline = vi.fn(headline)
    return { getActivityHeadline, getRecord, resolve: resolvePostWith({ getActivityHeadline, getRecord }) }
  }

  test('a public activity post takes its title from the activity loader', async () => {
    const { getActivityHeadline, getRecord, resolve } = setup(activityPost(), async () => 'Morning run')
    expect(await resolve('fiddur', POST_ID)).toEqual({
      created_at: '2026-11-01T07:30:00.000Z',
      description: 'Felt great',
      is_public: true,
      kind: 'activity',
      title: 'Morning run',
      updated_at: '2026-11-01T08:00:00.000Z',
    })
    expect(getRecord).toHaveBeenCalledWith('fiddur', POST_ID)
    expect(getActivityHeadline).toHaveBeenCalledWith('fiddur', ACTIVITY_ID)
  })

  test('carries how long a chart card may stand, for a post that can have a moving chart', async () => {
    const challenge = record({ include_chart: true, kind: 'challenge' })
    const { resolve } = setup(challenge, async () => null)
    expect(await resolve('fiddur', POST_ID)).toMatchObject({ chart_bucket_ms: 300_000, is_public: true })
    const reply = setup(record(), async () => null)
    expect(await reply.resolve('fiddur', POST_ID)).not.toHaveProperty('chart_bucket_ms')
  })

  test.each(['unlisted', 'followers'] as const)(
    'an %s post is not public, and its activity is never loaded',
    async (visibility) => {
      const { getActivityHeadline, resolve } = setup(activityPost({ visibility }), async () => 'Secret run')
      expect(await resolve('fiddur', POST_ID)).toEqual({ is_public: false })
      expect(getActivityHeadline).not.toHaveBeenCalled()
    },
  )

  test('an unknown post resolves to null', async () => {
    const { getActivityHeadline, resolve } = setup(null, async () => 'Morning run')
    expect(await resolve('fiddur', POST_ID)).toBeNull()
    expect(getActivityHeadline).not.toHaveBeenCalled()
  })

  test('a non-activity post loads no activity', async () => {
    const { getActivityHeadline, resolve } = setup(record({ message: 'Hi there' }), async () => 'x')
    expect(await resolve('fiddur', POST_ID)).toMatchObject({
      is_public: true,
      kind: 'reply',
      title: 'Hi there',
    })
    expect(getActivityHeadline).not.toHaveBeenCalled()
  })

  test('a failing loader resolves to null and is logged', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { resolve } = setup(activityPost(), async () => {
        throw new Error('connection reset')
      })
      expect(await resolve('fiddur', POST_ID)).toBeNull()
      expect(consoleError).toHaveBeenCalledTimes(1)
    } finally {
      consoleError.mockRestore()
    }
  })

  test('a missing user database resolves to null quietly', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const resolve = resolvePostWith({
        getActivityHeadline: async () => null,
        getRecord: async () => {
          throw Object.assign(new Error('database "ghost" does not exist'), { code: '3D000' })
        },
      })
      expect(await resolve('ghost', POST_ID)).toBeNull()
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })
})
