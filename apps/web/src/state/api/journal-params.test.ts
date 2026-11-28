import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, test } from 'vitest'

import { conflictFromError, journalSearchParams } from './journal-params'

describe('journalSearchParams', () => {
  test('sends only what is set', () => {
    expect(journalSearchParams({ q: '  ', tags: [] })).toEqual({})
  })

  test('sends a related filter as related_type and related_id', () => {
    expect(journalSearchParams({ related: { id: 'p1', type: 'person' } })).toEqual({
      related_id: 'p1',
      related_type: 'person',
    })
  })

  test('maps the journal filters to the search API', () => {
    expect(
      journalSearchParams({
        cursor: 'abc',
        include_comments: true,
        include_context: true,
        needs_text: true,
        on_this_day: '2026-11-20',
        q: ' lake ',
        tags: ['family', 'winter'],
        to: '2026-11-01',
        tz: 'Europe/Stockholm',
      }),
    ).toEqual({
      cursor: 'abc',
      entity_types: 'time,day,activity,meal,report',
      include_context: 'true',
      needs_text: 'true',
      on_this_day: '2026-11-20',
      q: 'lake',
      tags: 'family,winter',
      to: '2026-11-01',
      tz: 'Europe/Stockholm',
    })
  })
})

describe('conflictFromError', () => {
  const failure = (status: number, data: unknown) =>
    new AxiosError('failed', 'ERR', undefined, undefined, {
      config: { headers: new AxiosHeaders() },
      data,
      headers: {},
      status,
      statusText: '',
    })

  test('a 409 carries the entry as it now is', () => {
    const theirs = { content: 'Theirs', entity_type: 'day', id: 'x' }
    expect(conflictFromError(failure(409, { data: theirs, error: 'changed', success: false }))).toEqual(
      theirs,
    )
  })

  test('anything else is not a conflict', () => {
    expect(conflictFromError(failure(500, {}))).toBeUndefined()
    expect(conflictFromError(new Error('x'))).toBeUndefined()
  })
})
