import { describe, expect, test } from 'vitest'

import {
  addressingFor,
  AS_PUBLIC,
  type BuildCreateInput,
  buildCreateExercise,
  feedPostContent,
  formatActivityWindow,
} from './object.ts'

const base: BuildCreateInput = {
  activityType: 'running',
  actorUrl: 'https://aurboda.net/u/fredrik',
  aurbodaNs: 'https://aurboda.net/ns/activitystreams#',
  endTime: '2026-07-01T07:11:03Z',
  postId: 'https://aurboda.net/u/fredrik/feed/abc',
  scalars: [
    { key: 'distance', label: 'Distance', unit: 'km', value: 8.2 },
    { key: 'heart_rate_avg', label: 'Avg HR', unit: 'bpm', value: 148 },
    { key: 'hr_zone_minutes', value: { z2: 22, z3: 11 } },
  ],
  seriesEndpointBase: 'https://aurboda.net/api/public/fredrik/series',
  seriesMetrics: ['heart_rate'],
  startTime: '2026-07-01T06:30:00Z',
  title: 'Morning run',
  visibility: 'public',
}

describe('addressingFor', () => {
  const followers = 'https://aurboda.net/u/fredrik/followers'
  test('public → Public in to, followers in cc', () => {
    expect(addressingFor('public', followers)).toEqual({ cc: [followers], to: [AS_PUBLIC] })
  })
  test('unlisted → followers in to, Public in cc', () => {
    expect(addressingFor('unlisted', followers)).toEqual({ cc: [AS_PUBLIC], to: [followers] })
  })
  test('followers → followers only, no Public anywhere', () => {
    expect(addressingFor('followers', followers)).toEqual({ cc: [], to: [followers] })
  })
})

describe('buildCreateExercise', () => {
  test('produces a Create with a Note-first dual type and canonical ids', () => {
    const c = buildCreateExercise(base)
    expect(c.type).toBe('Create')
    expect(c.id).toBe('https://aurboda.net/u/fredrik/feed/abc')
    expect(c.actor).toBe(base.actorUrl)
    expect(c.published).toBe(base.startTime)
    expect(c.to).toEqual([AS_PUBLIC])
    expect(c.cc).toEqual(['https://aurboda.net/u/fredrik/followers'])
    expect(c.object.id).toBe('https://aurboda.net/u/fredrik/feed/abc/object')
    expect(c.object.type).toEqual(['Note', 'aurboda:Exercise'])
    expect(c.object.attributedTo).toBe(base.actorUrl)
    expect(c.object.url).toBe(base.postId)
  })

  test('@context maps the aurboda namespace prefix', () => {
    const c = buildCreateExercise(base)
    expect(c['@context']).toEqual([
      'https://www.w3.org/ns/activitystreams',
      { aurboda: 'https://aurboda.net/ns/activitystreams#' },
    ])
  })

  test('content is a bold title headline, the activity-date line, and one stat per line', () => {
    const c = buildCreateExercise(base)
    expect(c.object.content).toBe(
      '<p><strong>Morning run</strong></p>' +
        '<p>Wed, 1 Jul 2026, 06:30–07:11</p>' +
        '<p>Distance 8.2 km<br>Avg HR 148 bpm<br>Hr zone minutes z2 22, z3 11</p>',
    )
  })

  test('a personal message renders between the headline and the date line, and rides aurboda:message', () => {
    const c = buildCreateExercise({ ...base, message: 'Felt great,\nnegative splits!' })
    expect(c.object.content).toBe(
      '<p><strong>Morning run</strong></p>' +
        '<p>Felt great,<br>negative splits!</p>' +
        '<p>Wed, 1 Jul 2026, 06:30–07:11</p>' +
        '<p>Distance 8.2 km<br>Avg HR 148 bpm<br>Hr zone minutes z2 22, z3 11</p>',
    )
    expect(c.object['aurboda:message']).toBe('Felt great,\nnegative splits!')
  })

  test('no aurboda:message and no message paragraph for a blank message', () => {
    const c = buildCreateExercise({ ...base, message: '   ' })
    expect(c.object['aurboda:message']).toBeUndefined()
    expect(c.object.content).not.toContain('<p> ')
  })

  test('the date line renders in the given timezone', () => {
    const c = buildCreateExercise({ ...base, timeZone: 'Europe/Stockholm' })
    // 06:30Z–07:11Z is 08:30–09:11 CEST.
    expect(c.object.content).toContain('<p>Wed, 1 Jul 2026, 08:30–09:11</p>')
  })

  test('aurboda:metrics carries the machine-readable shared scalars only', () => {
    const c = buildCreateExercise(base)
    expect(c.object['aurboda:metrics']).toEqual([
      { key: 'distance', unit: 'km', value: 8.2 },
      { key: 'heart_rate_avg', unit: 'bpm', value: 148 },
      { key: 'hr_zone_minutes', value: { z2: 22, z3: 11 } },
    ])
  })

  test('duration is computed from the window', () => {
    const c = buildCreateExercise(base)
    expect(c.object['aurboda:durationSeconds']).toBe(2463)
    expect(c.object['aurboda:endTime']).toBe(base.endTime)
  })

  test('aurboda:series links only the explicitly-shared series metrics, scoped to the window', () => {
    const c = buildCreateExercise(base)
    expect(c.object['aurboda:series']).toEqual([
      {
        href: 'https://aurboda.net/api/public/fredrik/series?bucket=5s&end=2026-07-01T07%3A11%3A03Z&metric=heart_rate&start=2026-07-01T06%3A30%3A00Z',
        mediaType: 'application/json',
        metric: 'heart_rate',
      },
    ])
  })

  test('no series links when none were shared', () => {
    const c = buildCreateExercise({ ...base, seriesMetrics: [] })
    expect(c.object['aurboda:series']).toBeUndefined()
  })

  test('no series links for a followers-only post (public /series would 404)', () => {
    const c = buildCreateExercise({ ...base, seriesMetrics: ['heart_rate'], visibility: 'followers' })
    expect(c.object['aurboda:series']).toBeUndefined()
    // The scalar summary still rides along for followers.
    expect(c.object['aurboda:metrics']).toHaveLength(base.scalars.length)
  })

  test('no series links or duration for an open-ended activity (no end time)', () => {
    const c = buildCreateExercise({ ...base, endTime: undefined })
    expect(c.object['aurboda:series']).toBeUndefined()
    expect(c.object['aurboda:durationSeconds']).toBeUndefined()
    expect(c.object['aurboda:endTime']).toBeUndefined()
  })

  test('escapes HTML in the title for the fallback content', () => {
    const c = buildCreateExercise({ ...base, scalars: [], title: 'Run <b>x</b> & "go"' })
    expect(c.object.content).toBe(
      '<p><strong>Run &lt;b&gt;x&lt;/b&gt; &amp; &quot;go&quot;</strong></p>' +
        '<p>Wed, 1 Jul 2026, 06:30–07:11</p>',
    )
  })

  test('uses publishedAt for the AS2 published times, keeping the workout time in aurboda:startTime', () => {
    const c = buildCreateExercise({ ...base, publishedAt: '2026-07-01T20:00:00Z' })
    expect(c.published).toBe('2026-07-01T20:00:00Z')
    expect(c.object.published).toBe('2026-07-01T20:00:00Z')
    expect(c.object['aurboda:startTime']).toBe(base.startTime)
  })

  test('published defaults to startTime when publishedAt is omitted', () => {
    const c = buildCreateExercise(base)
    expect(c.published).toBe(base.startTime)
    expect(c.object.published).toBe(base.startTime)
  })

  test('falls back to a derived name when the activity has no title', () => {
    const c = buildCreateExercise({ ...base, title: undefined })
    expect(c.object.name).toBe('Running activity')
  })
})

describe('formatActivityWindow', () => {
  test('same-day window collapses the end to its time', () => {
    expect(formatActivityWindow('2026-08-02T13:44:00Z', '2026-08-02T16:12:00Z', 'Europe/Stockholm')).toBe(
      'Sun, 2 Aug 2026, 15:44–18:12',
    )
  })

  test('cross-day window spells out both ends', () => {
    expect(formatActivityWindow('2026-08-02T22:30:00Z', '2026-08-03T06:10:00Z', 'UTC')).toBe(
      'Sun, 2 Aug 2026, 22:30 – Mon, 3 Aug 2026, 06:10',
    )
  })

  test('open-ended activity renders only the start', () => {
    expect(formatActivityWindow('2026-08-02T13:44:00Z', undefined, 'UTC')).toBe('Sun, 2 Aug 2026, 13:44')
  })

  test('an invalid timezone falls back to UTC instead of throwing', () => {
    expect(formatActivityWindow('2026-08-02T13:44:00Z', undefined, 'Not/AZone')).toBe(
      'Sun, 2 Aug 2026, 13:44',
    )
  })
})

describe('feedPostContent', () => {
  test('renders a bold headline with one stat per line and a humanized duration', () => {
    const { content } = feedPostContent('Evening qigong', 'yoga', [
      { key: 'duration', label: 'Duration', unit: 'seconds', value: 642 },
      { key: 'heart_rate_avg', label: 'Avg HR', unit: 'bpm', value: 76 },
      { key: 'calories', label: 'Calories', unit: 'kcal', value: 9 },
    ])
    expect(content).toBe(
      '<p><strong>Evening qigong</strong></p><p>Duration 10m 42s<br>Avg HR 76 bpm<br>Calories 9 kcal</p>',
    )
  })

  test('escapes HTML in the message and preserves its linebreaks as <br>', () => {
    const { content } = feedPostContent('Row', 'rowing', [], {
      message: 'So <b>good</b>\n& calm',
      windowLabel: 'Sun, 2 Aug 2026, 15:44–18:12',
    })
    expect(content).toBe(
      '<p><strong>Row</strong></p>' +
        '<p>So &lt;b&gt;good&lt;/b&gt;<br>&amp; calm</p>' +
        '<p>Sun, 2 Aug 2026, 15:44–18:12</p>',
    )
  })

  test('renders hours and minutes for a long duration', () => {
    const { content } = feedPostContent('Long ride', 'cycling', [
      { key: 'duration', label: 'Duration', unit: 'seconds', value: 3720 },
    ])
    expect(content).toBe('<p><strong>Long ride</strong></p><p>Duration 1h 2m</p>')
  })

  test('untitled activity gets a type-derived headline and no stats line when nothing is shared', () => {
    const { content, name } = feedPostContent(undefined, 'yoga', [])
    expect(content).toBe('<p><strong>Yoga activity</strong></p>')
    expect(name).toBe('Yoga activity')
  })
})
