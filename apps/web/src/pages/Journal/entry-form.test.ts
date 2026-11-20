import type { Note } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  addTags,
  emptyEntryForm,
  entryFormProblem,
  formFromNote,
  formToCreateBody,
  formToUpdateBody,
  isEntryEmpty,
  sameEntry,
  tagChips,
} from './entry-form'

const base = emptyEntryForm(new Date(2026, 10, 20, 9, 30))

describe('tagChips', () => {
  test('explicit tags are removable, #hashtags from the text are not, and none is listed twice', () => {
    expect(tagChips(['family', 'winter'], 'Snow #Winter and #lake')).toEqual([
      { fromText: false, tag: 'family' },
      { fromText: false, tag: 'winter' },
      { fromText: true, tag: 'lake' },
    ])
  })
})

describe('addTags', () => {
  test('normalises, splits on commas and spaces, skips duplicates, reports invalid words', () => {
    expect(addTags(['family'], '#Travel, family 2026 good-day')).toEqual({
      rejected: ['2026', 'good-day'],
      tags: ['family', 'travel'],
    })
  })
})

describe('formFromNote', () => {
  test('a day entry keeps its date and the explicit tags only', () => {
    const note: Note = {
      content: 'Walked #winter',
      date: '2026-11-20',
      entity_type: 'day',
      id: 'x',
      tags: ['family', 'winter'],
      title: 'First snow',
    }
    expect(formFromNote(note)).toMatchObject({
      allDay: true,
      date: '2026-11-20',
      start: '2026-11-20T12:00',
      tags: ['family'],
      title: 'First snow',
    })
  })

  test('a timed entry fills start and end as local wall-clock values', () => {
    const start = new Date(2026, 10, 20, 8, 15)
    const end = new Date(2026, 10, 20, 9, 0)
    const form = formFromNote({
      content: '',
      end_time: end.toISOString(),
      entity_type: 'time',
      start_time: start.toISOString(),
    })
    expect(form).toMatchObject({
      allDay: false,
      date: '2026-11-20',
      end: '2026-11-20T09:00',
      start: '2026-11-20T08:15',
    })
  })
})

describe('bodies', () => {
  test('a day entry is created with its date and no times', () => {
    expect(formToCreateBody({ ...base, allDay: true, content: 'Hi', title: '  ' })).toEqual({
      content: 'Hi',
      date: '2026-11-20',
      entity_type: 'day',
      tags: [],
      title: null,
    })
  })

  test('a timed entry is created with its start and optional end', () => {
    const body = formToCreateBody({ ...base, end: '2026-11-20T10:00' })
    expect(body).toMatchObject({ entity_type: 'time' })
    expect(body.start_time).toBe(new Date(2026, 10, 20, 9, 30).toISOString())
    expect(body.end_time).toBe(new Date(2026, 10, 20, 10, 0).toISOString())
  })

  test('an update names the version it builds on and clears a removed end', () => {
    expect(formToUpdateBody(base, '2026-11-20T08:00:00.000Z')).toMatchObject({
      end_time: null,
      expected_updated_at: '2026-11-20T08:00:00.000Z',
    })
    expect(formToUpdateBody({ ...base, allDay: true }, undefined)).toEqual({
      content: '',
      date: '2026-11-20',
      tags: [],
      title: null,
    })
  })
})

describe('entryFormProblem', () => {
  test('needs a date or a start, and an end not before the start', () => {
    expect(entryFormProblem(base)).toBeUndefined()
    expect(entryFormProblem({ ...base, allDay: true, date: '' })).toBe('Pick a date.')
    expect(entryFormProblem({ ...base, start: '' })).toBe('Pick a date and time.')
    expect(entryFormProblem({ ...base, end: '2026-11-20T08:00' })).toBe('The end is before the start.')
  })
})

describe('isEntryEmpty and sameEntry', () => {
  test('an entry with pictures is not empty', () => {
    expect(isEntryEmpty({ content: ' ', title: '' }, 0)).toBe(true)
    expect(isEntryEmpty({ content: '', title: '' }, 2)).toBe(false)
    expect(isEntryEmpty({ content: '', title: 'Hi' }, 0)).toBe(false)
  })

  test('the time fields of a day entry do not matter', () => {
    expect(sameEntry({ ...base, allDay: true }, { ...base, allDay: true, start: '2020-01-01T00:00' })).toBe(
      true,
    )
    expect(sameEntry(base, { ...base, content: 'x' })).toBe(false)
  })
})
