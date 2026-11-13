import { describe, expect, test } from 'vitest'

import {
  activityLabel,
  autosharePendingDedupeKey,
  pendingAutoshareNotification,
  type PendingAutoshareInput,
  sharedAutoshareRevision,
  skippedAutoshareRevision,
} from './autoshare-notifications.ts'

const NOW = new Date('2026-11-13T12:00:00Z')
const MINUTE = 60_000

const input = (over: Partial<PendingAutoshareInput> = {}): PendingAutoshareInput => ({
  anchor: { activity_type: 'strength_training', id: 'act-1', title: null },
  detail_pending: false,
  now: NOW,
  rule: { id: 'rule-1', name: 'Gym', visibility: 'followers' },
  share_at: new Date(NOW.getTime() + 10 * MINUTE),
  ...over,
})

const titleIn = (ms: number): string =>
  pendingAutoshareNotification(input({ share_at: new Date(NOW.getTime() + ms) })).title

describe('activityLabel', () => {
  test('turns an activity type into lower-case words', () => {
    expect(activityLabel('strength_training')).toBe('strength training')
    expect(activityLabel('Running')).toBe('running')
  })
})

describe('pendingAutoshareNotification', () => {
  test('carries the type, dedupe key, link, skip action and data', () => {
    expect(pendingAutoshareNotification(input())).toEqual({
      actions: [{ key: 'skip', label: "Don't share" }],
      body: 'Rule: Gym · Followers only',
      data: {
        activity_id: 'act-1',
        activity_label: 'strength training',
        rule_id: 'rule-1',
        share_not_before: '2026-11-13T12:10:00.000Z',
      },
      dedupe_key: 'autoshare_pending:act-1',
      link: '/detail/activity/act-1',
      title: 'Your new strength training will be shared in about 10 minutes',
      type: 'autoshare_pending',
    })
  })

  test('says when, by bucket', () => {
    expect(titleIn(30_000)).toBe('Your new strength training will be shared in about a minute')
    expect(titleIn(-MINUTE)).toBe('Your new strength training will be shared in about a minute')
    expect(titleIn(2 * MINUTE)).toBe('Your new strength training will be shared in about 2 minutes')
    expect(titleIn(9 * MINUTE + 1)).toBe('Your new strength training will be shared in about 10 minutes')
    expect(titleIn(90 * MINUTE)).toBe('Your new strength training will be shared in about 90 minutes')
    expect(titleIn(91 * MINUTE)).toBe('Your new strength training will be shared in about 2 hours')
    expect(titleIn(5 * 60 * MINUTE)).toBe('Your new strength training will be shared in about 5 hours')
  })

  test('waiting only on the Garmin details says so', () => {
    expect(pendingAutoshareNotification(input({ detail_pending: true })).title).toBe(
      'Your new strength training will be shared once its Garmin details have synced',
    )
  })

  test('the body leads with the activity title when there is one, then the rule and visibility', () => {
    const body = (title: null | string, visibility: 'followers' | 'public' | 'unlisted') =>
      pendingAutoshareNotification(
        input({
          anchor: { activity_type: 'running', id: 'a', title },
          rule: { id: 'r', name: 'Runs', visibility },
        }),
      ).body
    expect(body('Morning run', 'public')).toBe('Morning run · Rule: Runs · Public')
    expect(body('  ', 'unlisted')).toBe('Rule: Runs · Unlisted')
  })
})

describe('revisions', () => {
  test('shared links to the post', () => {
    expect(sharedAutoshareRevision({ activity_label: 'run', post_id: 'p1', username: 'alice' })).toEqual({
      link: '/u/alice/posts/p1',
      title: 'Your run was shared',
    })
  })

  test('skipped says it will not be shared', () => {
    expect(skippedAutoshareRevision('run')).toEqual({ title: 'Your run will not be shared' })
  })

  test('dedupe key', () => {
    expect(autosharePendingDedupeKey('x')).toBe('autoshare_pending:x')
  })
})
