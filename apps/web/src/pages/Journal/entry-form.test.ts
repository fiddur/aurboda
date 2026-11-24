import type { Note } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { timelineHref } from '../Timeline/viewHash'
import {
  addTags,
  emptyEntryForm,
  entryDay,
  entryFormProblem,
  formFromNote,
  formToCreateBody,
  formToUpdateBody,
  discardOnLeave,
  isEntryEmpty,
  sameEntry,
  tagChips,
  entryTimelineHref,
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

describe('discardOnLeave', () => {
  test('an empty entry started in this visit is thrown away', () => {
    expect(discardOnLeave({ deleted: false, savedEntry: false }, true)).toBe(true)
    expect(discardOnLeave({ deleted: false, savedEntry: false }, false)).toBe(false)
  })

  test('a saved entry opened in the editor is never thrown away, even when its form reads empty', () => {
    expect(discardOnLeave({ deleted: false, savedEntry: true }, true)).toBe(false)
  })

  test('an entry already deleted is left alone', () => {
    expect(discardOnLeave({ deleted: true, savedEntry: false }, true)).toBe(false)
  })
})

describe('related links', () => {
  const anna = {
    entity_id: '00000000-0000-4000-8000-00000000000a',
    entity_type: 'person' as const,
    label: 'Anna',
  }

  test("a note's links fill the form; none is an empty list", () => {
    expect(
      formFromNote({ content: '', date: '2026-11-20', entity_type: 'day', related: [anna] }).related,
    ).toEqual([anna])
    expect(formFromNote({ content: '', date: '2026-11-20', entity_type: 'day' }).related).toEqual([])
  })

  test('a new entry sends its links without labels, and none when there are none', () => {
    expect(formToCreateBody({ ...base, related: [anna] }).related).toEqual([
      { entity_id: anna.entity_id, entity_type: 'person' },
    ])
    expect(formToCreateBody(base)).not.toHaveProperty('related')
  })

  test('the autosave sends related only when it differs from what the server confirmed', () => {
    expect(formToUpdateBody({ ...base, related: [anna] }, undefined, [anna])).not.toHaveProperty('related')
    expect(formToUpdateBody({ ...base, related: [anna] }, undefined, []).related).toEqual([
      { entity_id: anna.entity_id, entity_type: 'person' },
    ])
    expect(formToUpdateBody(base, undefined, [anna]).related).toEqual([])
  })

  test('two forms with other links are not the same entry', () => {
    expect(sameEntry(base, { ...base, related: [anna] })).toBe(false)
    expect(sameEntry({ ...base, related: [anna] }, { ...base, related: [{ ...anna, label: 'A' }] })).toBe(
      true,
    )
  })
})

describe('entryDay', () => {
  test('an all-day entry is on its date, a timed one on its start day', () => {
    expect(entryDay({ allDay: true, date: '2026-11-20', start: '2026-11-19T22:00' })).toBe('2026-11-20')
    expect(entryDay({ allDay: false, date: '2026-11-20', start: '2026-11-19T22:00' })).toBe('2026-11-19')
  })
})

describe('entryTimelineHref', () => {
  const form = { allDay: false, date: '', end: '', start: '' }

  test('a day entry shows its whole local day', () => {
    expect(entryTimelineHref({ ...form, allDay: true, date: '2026-11-20' })).toBe(
      timelineHref(new Date(2026, 10, 20), new Date(2026, 10, 21)),
    )
  })

  test('a timed entry shows the 24 hours around it', () => {
    expect(entryTimelineHref({ ...form, start: '2026-11-20T09:30' })).toBe(
      timelineHref(new Date(2026, 10, 20, 9, 30)),
    )
    expect(entryTimelineHref({ ...form, end: '2026-11-20T11:30', start: '2026-11-20T09:30' })).toBe(
      timelineHref(new Date(2026, 10, 20, 9, 30), new Date(2026, 10, 20, 11, 30)),
    )
  })

  test('none without a valid time or date', () => {
    expect(entryTimelineHref(form)).toBeUndefined()
    expect(entryTimelineHref({ ...form, allDay: true, date: '2026-11' })).toBeUndefined()
  })
})
