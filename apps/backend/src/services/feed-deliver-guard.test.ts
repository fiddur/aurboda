import { describe, expect, test, vi } from 'vitest'

import type { Activity, FeedPostRecord } from '../db/index.ts'
import type { FeedDeliver } from '../routes/feed-router.ts'

import { deliverFeedPostEdit, droppedMentions, withoutParticipantsDelivery } from './feed-deliver-guard.ts'

const post = (
  visibility: FeedPostRecord['visibility'],
  kind: FeedPostRecord['kind'] = 'reply',
): FeedPostRecord => ({
  activity_id: null,
  article: null,
  autoshare_rule_id: null,
  challenge: null,
  challenge_uri: 'https://aurboda.test/users/alice/challenges/abc',
  created_at: new Date('2026-10-06T00:00:00Z'),
  dashboard: null,
  exercise: null,
  id: 'p1',
  image_token: 't',
  in_reply_to_actor_uri: null,
  in_reply_to_handle: null,
  in_reply_to_uri: null,
  include_chart: false,
  include_exercises: false,
  include_map: false,
  included_metrics: [],
  kind,
  message: 'hi',
  series_metrics: [],
  tags: [],
  updated_at: new Date('2026-10-06T00:00:00Z'),
  visibility,
})

const recording = () => {
  const calls: string[] = []
  const hook =
    (name: string) =>
    (..._args: unknown[]): void => {
      calls.push(name)
    }
  const deliver: FeedDeliver = {
    created: hook('created'),
    createdArticle: hook('createdArticle'),
    createdChallenge: hook('createdChallenge'),
    createdDashboard: hook('createdDashboard'),
    createdExercise: hook('createdExercise'),
    createdReply: hook('createdReply'),
    deleted: hook('deleted'),
    updated: hook('updated'),
    updatedArticle: hook('updatedArticle'),
    updatedChallenge: hook('updatedChallenge'),
    updatedDashboard: hook('updatedDashboard'),
    updatedExercise: hook('updatedExercise'),
    updatedReply: hook('updatedReply'),
  }
  return { calls, deliver }
}

const everyHook = (deliver: FeedDeliver, record: FeedPostRecord) => {
  deliver.created('alice', record, {} as Activity)
  deliver.createdArticle('alice', record)
  deliver.createdChallenge('alice', record)
  deliver.createdDashboard('alice', record)
  deliver.createdExercise('alice', record)
  deliver.createdReply('alice', record)
  deliver.deleted('alice', record, [])
  deliver.updated('alice', record)
  deliver.updatedArticle('alice', record)
  deliver.updatedChallenge('alice', record)
  deliver.updatedDashboard('alice', record)
  deliver.updatedExercise('alice', record)
  deliver.updatedReply('alice', record)
}

describe('withoutParticipantsDelivery', () => {
  test('a participants post reaches no hook at all', () => {
    const { calls, deliver } = recording()
    everyHook(withoutParticipantsDelivery(deliver), post('participants'))
    expect(calls).toEqual([])
  })

  test('every other visibility passes through every hook', () => {
    for (const visibility of ['public', 'unlisted', 'followers'] as const) {
      const { calls, deliver } = recording()
      everyHook(withoutParticipantsDelivery(deliver), post(visibility))
      expect(calls).toHaveLength(13)
    }
  })
})

describe('deliverFeedPostEdit', () => {
  test('picks the hook of the post kind', () => {
    const { calls, deliver } = recording()
    deliverFeedPostEdit(deliver, 'alice', post('public', 'reply'))
    deliverFeedPostEdit(deliver, 'alice', post('public', 'challenge'))
    deliverFeedPostEdit(deliver, 'alice', post('public', 'activity'))
    deliverFeedPostEdit(undefined, 'alice', post('public'))
    expect(calls).toEqual(['updatedReply', 'updatedChallenge', 'updated'])
  })
})

describe('mentions dropped by an edit', () => {
  const anna = { actor_uri: 'https://example.social/users/anna', handle: '@anna@example.social' }
  const bo = { actor_uri: 'https://other.example/users/bo', handle: '@bo@other.example' }

  test('droppedMentions lists the accounts the edit no longer mentions', () => {
    expect(droppedMentions({ mentions: [anna, bo] }, { mentions: [bo] })).toEqual([anna])
    expect(droppedMentions({ mentions: [anna] }, { mentions: [anna, bo] })).toEqual([])
    expect(droppedMentions({}, { mentions: [anna] })).toEqual([])
  })

  test('an activity edit passes the dropped mentions to its Update, and only when there are some', () => {
    const updated = vi.fn()
    const deliver = { ...recording().deliver, updated }
    const after = { ...post('public', 'activity'), mentions: [bo] }
    deliverFeedPostEdit(deliver, 'alice', after, { mentions: [anna, bo] })
    deliverFeedPostEdit(deliver, 'alice', after, { mentions: [bo] })
    deliverFeedPostEdit(deliver, 'alice', after)
    expect(updated.mock.calls).toEqual([
      ['alice', after, [anna]],
      ['alice', after],
      ['alice', after],
    ])
  })

  test('a participants post drops its mentions with everything else', () => {
    const updated = vi.fn()
    const guarded = withoutParticipantsDelivery({ ...recording().deliver, updated })
    guarded.updated('alice', post('participants', 'activity'), [anna])
    guarded.updated('alice', post('public', 'activity'), [anna])
    expect(updated).toHaveBeenCalledTimes(1)
    expect(updated.mock.calls[0]![2]).toEqual([anna])
  })
})
