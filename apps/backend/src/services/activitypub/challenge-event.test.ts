import { describe, expect, test } from 'vitest'

import type { ChallengeRecord, ChallengeSpecFields } from '../../db/index.ts'

import {
  buildChallengeEvent,
  challengeEventExtension,
  fep8a8eContextEntry,
  renderChallengeEventHtml,
} from './challenge-event.ts'
import { createFeedFederation } from './federation.ts'
import { quantContextEntry } from './quant-extension.ts'

const ORIGIN = 'https://qs.example'
const START = new Date('2026-10-31T23:00:00Z')
const END = new Date('2026-11-30T23:00:00Z')
const NOW = new Date('2026-11-03T20:45:12Z')

const stepsSpec: ChallengeSpecFields = {
  activity_type_id: null,
  aggregation: 'sum',
  bucket_size: 'auto',
  filter_field: null,
  filter_value: null,
  measure: null,
  pattern: 'steps',
  source_type: 'metric',
  unit: 'steps',
}

const bestSetSpec: ChallengeSpecFields = {
  ...stepsSpec,
  aggregation: 'max',
  filter_field: 'sets.exercise',
  filter_value: 'Push-ups',
  measure: 'max_reps',
  pattern: 'strength_training',
  source_type: 'activity_type',
  unit: 'reps',
}

const challenge = (overrides: Partial<ChallengeRecord> = {}): ChallengeRecord => ({
  announce_winner: true,
  banner_updated_at: null,
  created_at: new Date('2026-10-20T10:00:00Z'),
  end_ts: END,
  id: 'c1',
  is_public: true,
  join_token: 'jt',
  name: 'November steps',
  result_published_at: null,
  slug: 'nov',
  spec: stepsSpec,
  start_ts: START,
  timezone: 'Europe/Stockholm',
  updated_at: new Date('2026-10-21T10:00:00Z'),
  ...overrides,
})

const host = { apiBaseUrl: `${ORIGIN}/api`, now: NOW, username: 'freja', webHost: ORIGIN }

describe('challengeEventExtension', () => {
  test('a metric challenge carries the document terms and its structured URL', () => {
    expect(challengeEventExtension(challenge(), host)).toEqual({
      joinMode: 'free',
      'quant:bucket': '1d',
      'quant:metric': 'steps',
      'quant:scoring': 'sum',
      'quant:structuredUrl': 'https://qs.example/api/public/freja/challenges/nov',
      'quant:unit': '1',
      timezone: 'Europe/Stockholm',
    })
  })

  test('an activity-measure challenge uses the extension metric key and its unit', () => {
    expect(challengeEventExtension(challenge({ spec: bestSetSpec }), host)).toMatchObject({
      'quant:metric': 'aurboda:maxReps',
      'quant:scoring': 'max',
      'quant:unit': 'reps',
    })
  })

  test('an ended challenge is closed to joins', () => {
    expect(challengeEventExtension(challenge(), { ...host, now: END }).joinMode).toBe('none')
  })
})

describe('renderChallengeEventHtml', () => {
  test('the name, what is measured over which dates, and the page link', () => {
    const html = renderChallengeEventHtml(challenge(), 'https://qs.example/u/freja/nov', NOW)
    expect(html).toContain('<p><strong>November steps</strong></p>')
    expect(html).toContain('Steps · ')
    expect(html).toContain('href="https://qs.example/u/freja/nov"')
  })

  test('escapes the name and the URL', () => {
    const html = renderChallengeEventHtml(
      challenge({ name: '<script>x</script> & co' }),
      'https://qs.example/u/freja/a"b',
      NOW,
    )
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; co')
    expect(html).not.toContain('<script>')
    expect(html).toContain('href="https://qs.example/u/freja/a&quot;b"')
  })
})

describe('buildChallengeEvent', () => {
  const contextFor = () => createFeedFederation(ORIGIN, `${ORIGIN}/api`).createContext(new URL(ORIGIN))
  const serialize = async (record: ChallengeRecord): Promise<Record<string, unknown>> => {
    const ctx = await contextFor()
    const event = buildChallengeEvent(ctx, 'freja', record, {
      apiBaseUrl: `${ORIGIN}/api`,
      now: NOW,
      webHost: ORIGIN,
    })
    return (await event.toJsonLd({ format: 'compact' })) as Record<string, unknown>
  }

  test('serializes as a dual-typed Event with the FEP-8a8e and quant terms', async () => {
    const doc = await serialize(challenge())
    expect(doc).toMatchObject({
      attributedTo: 'https://qs.example/users/freja',
      endTime: '2026-11-30T23:00:00Z',
      id: 'https://qs.example/users/freja/challenges/nov',
      joinMode: 'free',
      name: 'November steps',
      'quant:bucket': '1d',
      'quant:metric': 'steps',
      'quant:scoring': 'sum',
      'quant:structuredUrl': 'https://qs.example/api/public/freja/challenges/nov',
      'quant:unit': '1',
      startTime: '2026-10-31T23:00:00Z',
      timezone: 'Europe/Stockholm',
      to: 'as:Public',
      type: ['Event', 'quant:Challenge'],
      url: 'https://qs.example/u/freja/nov',
    })
    expect(doc['@context']).toContainEqual(quantContextEntry)
    expect(doc['@context']).toContainEqual(fep8a8eContextEntry)
  })

  test('an unlisted challenge is not addressed to the public', async () => {
    const doc = await serialize(challenge({ is_public: false }))
    expect(doc).not.toHaveProperty('to')
    expect(doc).not.toHaveProperty('cc')
    expect(doc.type).toEqual(['Event', 'quant:Challenge'])
  })
})
