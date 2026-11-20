import {
  addNoteBodySchema,
  DELETED_NOTE_RETENTION_DAYS,
  deleteNoteQuerySchema,
  normalizeNoteTags,
  normalizeNoteTitle,
  notesSearchQuerySchema,
  parseNotesSearchEntityTypes,
  parseNotesSearchTags,
  updateNoteBodySchema,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

const ok = (result: { success: boolean }) => expect(result.success).toBe(true)
const refused = (result: { success: boolean }) => expect(result.success).toBe(false)

describe('addNoteBodySchema', () => {
  test('a day entry needs a calendar date and nothing else', () => {
    ok(addNoteBodySchema.safeParse({ content: 'x', date: '2024-02-29', entity_type: 'day' }))
    refused(addNoteBodySchema.safeParse({ content: 'x', entity_type: 'day' }))
    refused(addNoteBodySchema.safeParse({ content: 'x', date: '2023-02-29', entity_type: 'day' }))
    refused(
      addNoteBodySchema.safeParse({ content: 'x', date: '2024-01-15', entity_id: 'x', entity_type: 'day' }),
    )
    refused(
      addNoteBodySchema.safeParse({
        content: 'x',
        date: '2024-01-15',
        entity_type: 'day',
        start_time: '2024-01-15T08:00:00Z',
      }),
    )
    refused(
      addNoteBodySchema.safeParse({
        content: 'x',
        date: '2024-01-15',
        end_time: '2024-01-15T08:00:00Z',
        entity_type: 'day',
      }),
    )
  })

  test('date is refused on every other shape', () => {
    refused(
      addNoteBodySchema.safeParse({
        content: 'x',
        date: '2024-01-15',
        entity_type: 'time',
        start_time: '2024-01-15T08:00:00Z',
      }),
    )
    refused(
      addNoteBodySchema.safeParse({
        content: 'x',
        date: '2024-01-15',
        entity_id: '2d0124e7-d161-4855-a54f-fa8bdb45c4f3',
        entity_type: 'activity',
      }),
    )
  })

  test('empty content only on time and day entries', () => {
    ok(addNoteBodySchema.safeParse({ content: '', date: '2024-01-15', entity_type: 'day' }))
    ok(addNoteBodySchema.safeParse({ content: '', entity_type: 'time', start_time: '2024-01-15T08:00:00Z' }))
    refused(
      addNoteBodySchema.safeParse({
        content: '',
        entity_id: '2d0124e7-d161-4855-a54f-fa8bdb45c4f3',
        entity_type: 'activity',
      }),
    )
    refused(
      addNoteBodySchema.safeParse({
        content: '',
        entity_id: '2d0124e7-d161-4855-a54f-fa8bdb45c4f3',
        entity_type: 'note',
      }),
    )
  })

  test('a title of at most 200 characters, not on a reply', () => {
    const base = { content: 'x', date: '2024-01-15', entity_type: 'day' as const }
    ok(addNoteBodySchema.safeParse({ ...base, title: 'x'.repeat(200) }))
    refused(addNoteBodySchema.safeParse({ ...base, title: 'x'.repeat(201) }))
    refused(
      addNoteBodySchema.safeParse({
        content: 'x',
        entity_id: '2d0124e7-d161-4855-a54f-fa8bdb45c4f3',
        entity_type: 'note',
        title: 'Reply title',
      }),
    )
    ok(
      addNoteBodySchema.safeParse({
        content: 'x',
        entity_id: '2d0124e7-d161-4855-a54f-fa8bdb45c4f3',
        entity_type: 'note',
        title: null,
      }),
    )
  })

  test('at most 20 valid tags', () => {
    const base = { content: 'x', date: '2024-01-15', entity_type: 'day' as const }
    ok(addNoteBodySchema.safeParse({ ...base, tags: ['#Travel', 'family_time', 'löpning'] }))
    refused(addNoteBodySchema.safeParse({ ...base, tags: ['two words'] }))
    refused(addNoteBodySchema.safeParse({ ...base, tags: ['2024'] }))
    refused(addNoteBodySchema.safeParse({ ...base, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }))
  })
})

describe('updateNoteBodySchema', () => {
  test('takes the journal fields; any one of them is enough', () => {
    ok(updateNoteBodySchema.safeParse({ date: '2024-01-15' }))
    ok(updateNoteBodySchema.safeParse({ title: null }))
    ok(updateNoteBodySchema.safeParse({ tags: [] }))
    ok(updateNoteBodySchema.safeParse({ content: '' }))
    refused(updateNoteBodySchema.safeParse({}))
    refused(updateNoteBodySchema.safeParse({ expected_updated_at: '2024-01-15T08:00:00Z' }))
  })

  test('date is refused together with times', () => {
    refused(updateNoteBodySchema.safeParse({ date: '2024-01-15', start_time: '2024-01-15T08:00:00Z' }))
    refused(updateNoteBodySchema.safeParse({ date: '2024-01-15', end_time: null }))
  })

  test('expected_updated_at must be an instant', () => {
    ok(updateNoteBodySchema.safeParse({ content: 'x', expected_updated_at: '2024-01-15T08:00:00.123Z' }))
    refused(updateNoteBodySchema.safeParse({ content: 'x', expected_updated_at: 'yesterday' }))
  })
})

describe('notesSearchQuerySchema', () => {
  test('parses a full query, coercing the limit', () => {
    const result = notesSearchQuerySchema.safeParse({
      cursor: 'abc',
      entity_types: 'time,day,activity',
      from: '2024-01-01',
      limit: '25',
      on_this_day: '2026-02-28',
      q: 'walk',
      tags: 'travel,#Family',
      to: '2024-12-31',
      tz: 'Europe/Stockholm',
    })
    expect(result.success && result.data.limit).toBe(25)
  })

  test.each([
    ['replies as a root type', { entity_types: 'note' }],
    ['an unknown type', { entity_types: 'banana' }],
    ['an invalid tag', { tags: 'two words' }],
    ['a limit of 0', { limit: '0' }],
    ['a limit over 200', { limit: '201' }],
    ['an unknown timezone', { tz: 'Nowhere/Special' }],
    ['to before from', { from: '2024-02-01', to: '2024-01-01' }],
    ['a date off the calendar', { from: '2023-02-29' }],
  ])('refuses %s', (_label, query) => {
    refused(notesSearchQuerySchema.safeParse(query))
  })

  test('the list parameters', () => {
    expect(parseNotesSearchEntityTypes(undefined)).toEqual(['time', 'day'])
    expect(parseNotesSearchEntityTypes(' meal , time,meal')).toEqual(['meal', 'time'])
    expect(parseNotesSearchTags(undefined)).toEqual([])
    expect(parseNotesSearchTags('#Travel, family,travel')).toEqual(['travel', 'family'])
    expect(parseNotesSearchTags('two words')).toBeNull()
  })
})

describe('deleteNoteQuerySchema', () => {
  test('purge is a query boolean', () => {
    expect(deleteNoteQuerySchema.parse({ purge: 'true' }).purge).toBe(true)
    expect(deleteNoteQuerySchema.parse({ purge: 'false' }).purge).toBe(false)
    expect(deleteNoteQuerySchema.parse({}).purge).toBeUndefined()
    refused(deleteNoteQuerySchema.safeParse({ purge: 'maybe' }))
  })
})

describe('note helpers', () => {
  test('tags are stored lowercase without # and deduplicated; one invalid refuses them all', () => {
    expect(normalizeNoteTags(['#Travel', 'travel', 'Family'])).toEqual(['travel', 'family'])
    expect(normalizeNoteTags(['ok', 'not ok'])).toBeNull()
  })

  test('a title is trimmed, and a blank one is none', () => {
    expect(normalizeNoteTitle('  Away  ')).toBe('Away')
    expect(normalizeNoteTitle('   ')).toBeNull()
    expect(normalizeNoteTitle(null)).toBeNull()
    expect(normalizeNoteTitle(undefined)).toBeUndefined()
  })

  test('deleted comments are kept for 30 days', () => {
    expect(DELETED_NOTE_RETENTION_DAYS).toBe(30)
  })
})
