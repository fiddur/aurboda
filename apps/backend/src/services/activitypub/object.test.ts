import { describe, expect, test } from 'vitest'

import { addressingFor, AS_PUBLIC, type BuildCreateInput, buildCreateExercise } from './object.ts'

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

  test('content flattens exactly the shared scalars behind the title', () => {
    const c = buildCreateExercise(base)
    expect(c.object.content).toBe(
      '<p>Morning run · Distance 8.2 km · Avg HR 148 bpm · Hr zone minutes z2 22, z3 11</p>',
    )
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
    expect(c.object.content).toBe('<p>Run &lt;b&gt;x&lt;/b&gt; &amp; &quot;go&quot;</p>')
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
