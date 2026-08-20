import { Note } from '@fedify/fedify/vocab'
import { describe, expect, test } from 'vitest'

import type { QuantExerciseInput } from './quant-extension.ts'

import {
  quantContextDocument,
  quantContextEntry,
  quantExerciseExtension,
  spliceQuantExtension,
  withQuantJsonLd,
} from './quant-extension.ts'

const base: QuantExerciseInput = {
  activityType: 'running',
  apiBaseUrl: 'https://aurboda.net/api/',
  endTime: new Date('2026-07-01T07:11:03Z'),
  imageToken: 'secret-token',
  postId: 'abc123',
  scalars: [
    { key: 'distance', label: 'Distance', unit: 'km', value: 8.2 },
    { key: 'hr_zone_minutes', value: { z2: 22, z3: 11 } },
  ],
  seriesMetrics: ['heart_rate'],
  startTime: new Date('2026-07-01T06:30:00Z'),
  user: 'fiddur',
  visibility: 'public',
}

describe('quantExerciseExtension', () => {
  test('carries the activity type and the machine-readable shared scalars only', () => {
    const props = quantExerciseExtension(base)
    expect(props['quant:activityType']).toBe('running')
    // Labels are content-only; a unit-less scalar omits the unit key entirely.
    expect(props['quant:metrics']).toEqual([
      { key: 'distance', unit: 'km', value: 8.2 },
      { key: 'hr_zone_minutes', value: { z2: 22, z3: 11 } },
    ])
  })

  test('links the structured payload without a token on a public post', () => {
    const props = quantExerciseExtension(base)
    expect(props['quant:structuredUrl']).toBe('https://aurboda.net/api/public/fiddur/feed/abc123')
  })

  test('a followers-only post carries the capability token on the structured URL (FEP §9)', () => {
    const props = quantExerciseExtension({ ...base, visibility: 'followers' })
    expect(props['quant:structuredUrl']).toBe(
      'https://aurboda.net/api/public/fiddur/feed/abc123?token=secret-token',
    )
  })

  test('series links only the explicitly-shared series metrics, scoped to the window', () => {
    const props = quantExerciseExtension(base)
    expect(props['quant:series']).toEqual([
      {
        href: 'https://aurboda.net/api/public/fiddur/series?bucket=5s&end=2026-07-01T07%3A11%3A03.000Z&metric=heart_rate&start=2026-07-01T06%3A30%3A00.000Z',
        mediaType: 'application/json',
        metric: 'heart_rate',
      },
    ])
  })

  test('no series links when none were shared', () => {
    expect(quantExerciseExtension({ ...base, seriesMetrics: [] })['quant:series']).toBeUndefined()
  })

  test('no series links for a followers-only post (public /series would 404)', () => {
    const props = quantExerciseExtension({ ...base, visibility: 'followers' })
    expect(props['quant:series']).toBeUndefined()
    // The scalar summary still rides along for followers.
    expect(props['quant:metrics']).toHaveLength(base.scalars.length)
  })

  test('no series links for an open-ended activity (no end time)', () => {
    expect(quantExerciseExtension({ ...base, endTime: undefined })['quant:series']).toBeUndefined()
  })
})

describe('spliceQuantExtension', () => {
  const props = { 'quant:activityType': 'running' }

  test('splices a bare object document: dual type, props, extended @context', () => {
    const doc = {
      '@context': ['https://www.w3.org/ns/activitystreams'],
      content: '<p>x</p>',
      type: 'Note',
    }
    expect(spliceQuantExtension(doc, props)).toEqual({
      '@context': ['https://www.w3.org/ns/activitystreams', quantContextEntry],
      content: '<p>x</p>',
      'quant:activityType': 'running',
      type: ['Note', 'quant:Exercise'],
    })
  })

  test('wraps a plain string @context into an array with the quant entry', () => {
    const out = spliceQuantExtension(
      { '@context': 'https://www.w3.org/ns/activitystreams', type: 'Note' },
      props,
    )
    expect(out).toMatchObject({
      '@context': ['https://www.w3.org/ns/activitystreams', quantContextEntry],
    })
  })

  test('splices an activity document into its embedded object, extending both contexts', () => {
    const doc = {
      '@context': ['https://www.w3.org/ns/activitystreams'],
      object: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        content: '<p>x</p>',
        type: 'Note',
      },
      type: 'Create',
    }
    const out = spliceQuantExtension(doc, props)
    expect(out).toEqual({
      '@context': ['https://www.w3.org/ns/activitystreams', quantContextEntry],
      object: {
        '@context': ['https://www.w3.org/ns/activitystreams', quantContextEntry],
        content: '<p>x</p>',
        'quant:activityType': 'running',
        type: ['Note', 'quant:Exercise'],
      },
      type: 'Create',
    })
  })

  test('is idempotent on the type (never doubles quant:Exercise)', () => {
    const once = spliceQuantExtension({ type: ['Note', 'quant:Exercise'] }, props)
    expect(once).toMatchObject({ type: ['Note', 'quant:Exercise'] })
  })

  test('passes a non-record document through untouched', () => {
    expect(spliceQuantExtension('x', props)).toBe('x')
    expect(spliceQuantExtension(null, props)).toBe(null)
  })
})

describe('withQuantJsonLd', () => {
  test('a wrapped Note serializes with the extension and the quant @context entry', async () => {
    const note = new Note({
      content: '<p><strong>Morning run</strong></p>',
      id: new URL('https://aurboda.net/users/fiddur/feed/abc123'),
      name: 'Morning run',
    })
    const wrapped = withQuantJsonLd(note, quantExerciseExtension(base))
    const doc = await wrapped.toJsonLd()
    expect(doc).toMatchObject({
      id: 'https://aurboda.net/users/fiddur/feed/abc123',
      'quant:activityType': 'running',
      'quant:structuredUrl': 'https://aurboda.net/api/public/fiddur/feed/abc123',
      type: ['Note', 'quant:Exercise'],
    })
    if (typeof doc !== 'object' || doc === null || !('@context' in doc)) throw new Error('no @context')
    expect(doc['@context']).toContainEqual(quantContextEntry)
  })
})

describe('quantContextDocument', () => {
  test('the published context is exactly the inline entry', () => {
    expect(quantContextDocument).toEqual({ '@context': quantContextEntry })
  })
})
