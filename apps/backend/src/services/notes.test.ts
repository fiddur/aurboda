import { NOTE_REPLY_RELATED_ERROR, NOTES_SEARCH_RELATED_PAIR_ERROR } from '@aurboda/api-spec'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import {
  addNote,
  decodeNotesCursor,
  deleteNoteById,
  encodeNotesCursor,
  getJournalNeighbors,
  getNoteForUser,
  getNoteRevisionsById,
  getNotesForEntity,
  getNotesInRange,
  journalExcerpt,
  listDeletedNotes,
  listJournalEntryRefs,
  listNoteTagsForUser,
  mergeNoteTags,
  mergeTagsInNote,
  noteRelatedLabel,
  onThisDayFilter,
  restoreNoteById,
  searchNotesForUser,
  splitSearchText,
  syncNoteTimesForEntity,
  toNoteNeighbor,
  updateNote,
} from './notes.ts'

vi.mock('../db', () => ({
  deleteNote: vi.fn(),
  getActivityById: vi.fn(),
  getDeletedNotes: vi.fn(),
  getMealById: vi.fn(),
  getNoteAttachmentsForNoteIds: vi.fn(async () => new Map()),
  getNoteById: vi.fn(),
  getNoteLinksForNoteIds: vi.fn(async () => new Map()),
  getNoteNeighbors: vi.fn(),
  getNoteRevisions: vi.fn(),
  getNoteRoot: vi.fn(),
  getNotesForEntity: vi.fn(),
  getNotesForTimeRange: vi.fn(),
  getNotesWithAnyTag: vi.fn(),
  getPerson: vi.fn(),
  getProductivityById: vi.fn(),
  getReportById: vi.fn(),
  getRepliesForRootIds: vi.fn(async () => new Map()),
  insertNote: vi.fn(),
  listLiveLinkTargetIds: vi.fn(async () => []),
  listNoteTags: vi.fn(),
  listNotesRelatedTo: vi.fn(async () => []),
  restoreNote: vi.fn(),
  searchNotes: vi.fn(),
  softDeleteNote: vi.fn(),
  updateNoteGuarded: vi.fn(),
  updateNoteTimesForEntity: vi.fn(),
}))

vi.mock('./settings.ts', () => ({ getUserTimezone: vi.fn(async () => 'Europe/Stockholm') }))

const PLAIN = { hashtags: [] }

const makeNote = (overrides: Partial<db.Note> = {}): db.Note => ({
  content: 'Test note',
  created_at: new Date('2024-01-15T10:00:00Z'),
  end_time: undefined,
  entity_id: randomUUID(),
  entity_type: 'activity' as const,
  id: randomUUID(),
  start_time: undefined,
  updated_at: new Date('2024-01-15T10:00:00Z'),
  ...overrides,
})

describe('addNote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getRepliesForRootIds).mockResolvedValue(new Map())
  })

  test('inherits start_time and end_time from a tag entity (now activity)', async () => {
    const tagId = randomUUID()
    const tagStart = new Date('2024-01-15T08:15:00Z')
    const tagEnd = new Date('2024-01-15T08:45:00Z')

    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'morning_run',
      end_time: tagEnd,
      id: tagId,
      source: 'aurboda',
      start_time: tagStart,
    })

    const note = makeNote({
      end_time: tagEnd,
      entity_id: tagId,
      entity_type: 'activity',
      start_time: tagStart,
    })
    vi.mocked(db.insertNote).mockResolvedValue(note)

    const result = await addNote('user', {
      content: 'Great session',
      entity_id: tagId,
      entity_type: 'activity',
    })

    expect(db.getActivityById).toHaveBeenCalledWith('user', tagId)
    expect(db.insertNote).toHaveBeenCalledWith(
      'user',
      'activity',
      tagId,
      'Great session',
      tagStart,
      tagEnd,
      PLAIN,
    )
    expect(result.success).toBe(true)
    expect(result.data?.start_time).toBe(tagStart.toISOString())
    expect(result.data?.end_time).toBe(tagEnd.toISOString())
  })

  test('inherits start_time only when tag has no end_time', async () => {
    const tagId = randomUUID()
    const tagStart = new Date('2024-01-15T08:15:00Z')

    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'coffee',
      end_time: undefined,
      id: tagId,
      source: 'aurboda',
      start_time: tagStart,
    })

    const note = makeNote({ entity_id: tagId, entity_type: 'activity', start_time: tagStart })
    vi.mocked(db.insertNote).mockResolvedValue(note)

    await addNote('user', { content: 'Note', entity_id: tagId, entity_type: 'activity' })

    expect(db.insertNote).toHaveBeenCalledWith('user', 'activity', tagId, 'Note', tagStart, undefined, PLAIN)
  })

  test('returns undefined times when tag entity not found', async () => {
    const tagId = randomUUID()
    vi.mocked(db.getActivityById).mockResolvedValue(null)

    const note = makeNote({ entity_id: tagId, entity_type: 'activity' })
    vi.mocked(db.insertNote).mockResolvedValue(note)

    await addNote('user', { content: 'Orphan note', entity_id: tagId, entity_type: 'activity' })

    expect(db.insertNote).toHaveBeenCalledWith(
      'user',
      'activity',
      tagId,
      'Orphan note',
      undefined,
      undefined,
      PLAIN,
    )
  })

  test('inherits times from an activity entity', async () => {
    const activityId = randomUUID()
    const start = new Date('2024-01-15T10:00:00Z')
    const end = new Date('2024-01-15T11:00:00Z')

    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      end_time: end,
      id: activityId,
      source: 'aurboda',
      start_time: start,
    })

    const note = makeNote({
      end_time: end,
      entity_id: activityId,
      entity_type: 'activity',
      start_time: start,
    })
    vi.mocked(db.insertNote).mockResolvedValue(note)

    await addNote('user', { content: 'Good run', entity_id: activityId, entity_type: 'activity' })

    expect(db.getActivityById).toHaveBeenCalledWith('user', activityId)
    expect(db.insertNote).toHaveBeenCalledWith('user', 'activity', activityId, 'Good run', start, end, PLAIN)
  })

  test('inherits times from a productivity entity', async () => {
    const prodId = randomUUID()
    const start = new Date('2024-01-15T09:00:00Z')
    const end = new Date('2024-01-15T09:30:00Z')

    vi.mocked(db.getProductivityById).mockResolvedValue({
      activity: 'VS Code',
      duration_sec: 1800,
      end_time: end,
      id: prodId,
      start_time: start,
    })

    const note = makeNote({
      end_time: end,
      entity_id: prodId,
      entity_type: 'productivity',
      start_time: start,
    })
    vi.mocked(db.insertNote).mockResolvedValue(note)

    await addNote('user', { content: 'Focus session', entity_id: prodId, entity_type: 'productivity' })

    expect(db.getProductivityById).toHaveBeenCalledWith('user', prodId)
    expect(db.insertNote).toHaveBeenCalledWith(
      'user',
      'productivity',
      prodId,
      'Focus session',
      start,
      end,
      PLAIN,
    )
  })

  test('does not look up entity or set times for metric notes', async () => {
    const metricEntityId = '2024-01-15T10:30:00.000Z|heart_rate|oura'

    const note = makeNote({ entity_id: metricEntityId, entity_type: 'metric' })
    vi.mocked(db.insertNote).mockResolvedValue(note)

    await addNote('user', { content: 'HRV low', entity_id: metricEntityId, entity_type: 'metric' })

    expect(db.getActivityById).not.toHaveBeenCalled()
    expect(db.getProductivityById).not.toHaveBeenCalled()
    expect(db.insertNote).toHaveBeenCalledWith(
      'user',
      'metric',
      metricEntityId,
      'HRV low',
      undefined,
      undefined,
      PLAIN,
    )
  })

  test('a note about a live person has no times', async () => {
    const personId = randomUUID()
    vi.mocked(db.getPerson).mockResolvedValue({ id: personId } as db.PersonRecord)
    vi.mocked(db.insertNote).mockResolvedValue(makeNote({ entity_id: personId, entity_type: 'person' }))

    const result = await addNote('user', {
      content: 'Loves rhubarb',
      entity_id: personId,
      entity_type: 'person',
    })

    expect(result.success).toBe(true)
    expect(db.getPerson).toHaveBeenCalledWith('user', personId)
    expect(db.insertNote).toHaveBeenCalledWith(
      'user',
      'person',
      personId,
      'Loves rhubarb',
      undefined,
      undefined,
      PLAIN,
    )
  })

  test('a note about an unknown or deleted person is refused as not found', async () => {
    vi.mocked(db.getPerson).mockResolvedValue(null)

    const result = await addNote('user', { content: 'x', entity_id: randomUUID(), entity_type: 'person' })

    expect(result).toMatchObject({ errorCode: 'not_found', success: false })
    expect(db.insertNote).not.toHaveBeenCalled()
  })

  test('returns note data including time fields', async () => {
    const tagId = randomUUID()
    const start = new Date('2024-01-15T08:00:00Z')
    const end = new Date('2024-01-15T09:00:00Z')

    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'coffee',
      end_time: end,
      id: tagId,
      source: 'aurboda',
      start_time: start,
    })

    const noteId = randomUUID()
    vi.mocked(db.insertNote).mockResolvedValue(
      makeNote({
        content: 'A note',
        created_at: new Date('2024-01-15T10:00:00Z'),
        end_time: end,
        entity_id: tagId,
        entity_type: 'activity',
        id: noteId,
        start_time: start,
        updated_at: new Date('2024-01-15T10:00:00Z'),
      }),
    )

    const result = await addNote('user', { content: 'A note', entity_id: tagId, entity_type: 'activity' })

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({
      content: 'A note',
      end_time: end.toISOString(),
      entity_id: tagId,
      entity_type: 'activity',
      id: noteId,
      start_time: start.toISOString(),
    })
  })
})

describe('addNote — time comments and replies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getRepliesForRootIds).mockResolvedValue(new Map())
  })

  test('inserts a time comment with a null entity_id and the supplied times', async () => {
    const start = new Date('2024-01-15T12:00:00Z')
    const end = new Date('2024-01-15T13:00:00Z')
    vi.mocked(db.insertNote).mockResolvedValue(
      makeNote({ end_time: end, entity_id: null, entity_type: 'time', start_time: start }),
    )

    const result = await addNote('user', {
      content: 'Felt off around lunch',
      end_time: end.toISOString(),
      entity_type: 'time',
      start_time: start.toISOString(),
    })

    expect(db.insertNote).toHaveBeenCalledWith(
      'user',
      'time',
      null,
      'Felt off around lunch',
      start,
      end,
      PLAIN,
    )
    expect(result.success).toBe(true)
    expect(result.data?.entity_id).toBeNull()
    expect(result.data?.attachments).toEqual([])
  })

  test('a new day entry answers with empty attachments, a reply with none', async () => {
    vi.mocked(db.insertNote).mockResolvedValue(
      makeNote({ date: '2024-01-15', entity_id: null, entity_type: 'day' }),
    )
    const day = await addNote('user', { content: '', date: '2024-01-15', entity_type: 'day' })
    expect(day.data?.attachments).toEqual([])

    const root = makeNote({ entity_id: null, entity_type: 'time', start_time: new Date() })
    vi.mocked(db.getNoteRoot).mockResolvedValue(root)
    vi.mocked(db.insertNote).mockResolvedValue(makeNote({ entity_id: root.id, entity_type: 'note' }))
    const reply = await addNote('user', { content: 'Reply', entity_id: root.id, entity_type: 'note' })
    expect(reply.data?.attachments).toBeUndefined()
    expect(db.getNoteAttachmentsForNoteIds).not.toHaveBeenCalled()
  })

  test('rejects a time comment without start_time', async () => {
    const result = await addNote('user', { content: 'When?', entity_type: 'time' })

    expect(result.success).toBe(false)
    expect(result.error).toBe("start_time is required when entity_type is 'time'")
    expect(db.insertNote).not.toHaveBeenCalled()
  })

  test('rejects a time comment that also carries an entity_id', async () => {
    const result = await addNote('user', {
      content: 'Ambiguous',
      entity_id: randomUUID(),
      entity_type: 'time',
      start_time: '2024-01-15T12:00:00.000Z',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe("entity_id must be omitted when entity_type is 'time'")
    expect(db.insertNote).not.toHaveBeenCalled()
  })

  test('rejects times on a comment anchored to an entity', async () => {
    const result = await addNote('user', {
      content: 'Nope',
      entity_id: randomUUID(),
      entity_type: 'activity',
      start_time: '2024-01-15T12:00:00.000Z',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Times can only be set on a time-anchored comment')
    expect(db.insertNote).not.toHaveBeenCalled()
  })

  test('rejects a time comment whose end precedes its start', async () => {
    const result = await addNote('user', {
      content: 'Backwards',
      end_time: '2024-01-15T11:00:00.000Z',
      entity_type: 'time',
      start_time: '2024-01-15T12:00:00.000Z',
    })

    expect(result).toMatchObject({ errorCode: 'invalid', success: false })
    expect(result.error).toBe('end_time must not precede start_time')
    expect(db.insertNote).not.toHaveBeenCalled()
  })

  test.each(['activity', 'productivity', 'report', 'meal', 'note', 'person'] as const)(
    'rejects a non-UUID entity_id for entity_type %s',
    async (entityType) => {
      const result = await addNote('user', {
        content: 'Hm',
        entity_id: 'not-a-uuid',
        entity_type: entityType,
      })

      expect(result).toMatchObject({ errorCode: 'invalid', success: false })
      expect(result.error).toBe(`entity_id must be a UUID when entity_type is '${entityType}'`)
      expect(db.insertNote).not.toHaveBeenCalled()
      expect(db.getNoteRoot).not.toHaveBeenCalled()
      expect(db.getPerson).not.toHaveBeenCalled()
    },
  )

  test('rejects a comment with no entity_id on an anchored type', async () => {
    const result = await addNote('user', { content: 'Nope', entity_type: 'activity' })

    expect(result.success).toBe(false)
    expect(result.error).toBe("entity_id is required unless entity_type is 'time' or 'day'")
    expect(db.insertNote).not.toHaveBeenCalled()
  })

  test('replying to a reply re-anchors to the thread root', async () => {
    const rootId = randomUUID()
    const replyId = randomUUID()
    const rootStart = new Date('2024-01-15T12:00:00Z')
    const rootEnd = new Date('2024-01-15T12:30:00Z')

    vi.mocked(db.getNoteRoot).mockResolvedValue(
      makeNote({
        end_time: rootEnd,
        entity_id: null,
        entity_type: 'time',
        id: rootId,
        start_time: rootStart,
      }),
    )
    vi.mocked(db.insertNote).mockResolvedValue(
      makeNote({
        end_time: rootEnd,
        entity_id: rootId,
        entity_type: 'note',
        start_time: rootStart,
      }),
    )

    const result = await addNote('user', {
      content: 'Me too',
      entity_id: replyId,
      entity_type: 'note',
    })

    expect(db.getNoteRoot).toHaveBeenCalledWith('user', replyId)
    expect(db.insertNote).toHaveBeenCalledWith('user', 'note', rootId, 'Me too', rootStart, rootEnd, PLAIN)
    expect(result.success).toBe(true)
    expect(result.data?.entity_id).toBe(rootId)
  })

  test('fails when the comment being replied to does not exist', async () => {
    vi.mocked(db.getNoteRoot).mockResolvedValue(null)

    const result = await addNote('user', {
      content: 'Hello?',
      entity_id: randomUUID(),
      entity_type: 'note',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Comment to reply to not found')
    expect(db.insertNote).not.toHaveBeenCalled()
  })

  test('inherits the meal time for a comment on a meal', async () => {
    const mealId = randomUUID()
    const mealTime = new Date('2024-01-15T18:30:00Z')
    vi.mocked(db.getMealById).mockResolvedValue({
      created_at: mealTime,
      id: mealId,
      source: 'aurboda',
      time: mealTime,
    })
    vi.mocked(db.insertNote).mockResolvedValue(
      makeNote({ entity_id: mealId, entity_type: 'meal', start_time: mealTime }),
    )

    await addNote('user', { content: 'Too salty', entity_id: mealId, entity_type: 'meal' })

    expect(db.getMealById).toHaveBeenCalledWith('user', mealId)
    expect(db.insertNote).toHaveBeenCalledWith(
      'user',
      'meal',
      mealId,
      'Too salty',
      mealTime,
      undefined,
      PLAIN,
    )
  })
})

describe('addNote — day entries, titles and tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('inserts a day entry with its date and no times, empty text allowed', async () => {
    vi.mocked(db.insertNote).mockResolvedValue(
      makeNote({ content: '', date: '2024-02-29', entity_id: null, entity_type: 'day' }),
    )

    const result = await addNote('user', { content: '', date: '2024-02-29', entity_type: 'day' })

    expect(db.insertNote).toHaveBeenCalledWith('user', 'day', null, '', undefined, undefined, {
      date: '2024-02-29',
      hashtags: [],
    })
    expect(result.data).toMatchObject({ date: '2024-02-29', entity_type: 'day', tags: [] })
  })

  test.each([
    ['a day entry without a date', { content: 'x', entity_type: 'day' as const }],
    [
      'a day entry on a date off the calendar',
      { content: 'x', date: '2023-02-29', entity_type: 'day' as const },
    ],
    [
      'a day entry with an entity_id',
      { content: 'x', date: '2024-01-01', entity_id: 'x', entity_type: 'day' as const },
    ],
    [
      'a day entry with a start_time',
      {
        content: 'x',
        date: '2024-01-01',
        entity_type: 'day' as const,
        start_time: '2024-01-01T08:00:00.000Z',
      },
    ],
    [
      'a date on a time entry',
      {
        content: 'x',
        date: '2024-01-01',
        entity_type: 'time' as const,
        start_time: '2024-01-01T08:00:00.000Z',
      },
    ],
    [
      'empty text on an entity comment',
      { content: '', entity_id: randomUUID(), entity_type: 'activity' as const },
    ],
    [
      'a title on a reply',
      { content: 'x', entity_id: randomUUID(), entity_type: 'note' as const, title: 'T' },
    ],
    [
      'an invalid tag',
      { content: 'x', entity_type: 'time' as const, start_time: '2024-01-01T08:00:00.000Z', tags: ['12'] },
    ],
    [
      'more than 20 tags',
      {
        content: 'x',
        entity_type: 'time' as const,
        start_time: '2024-01-01T08:00:00.000Z',
        tags: Array.from({ length: 21 }, (_, i) => `tag${i}`),
      },
    ],
  ])('refuses %s', async (_label, input) => {
    const result = await addNote('user', input)
    expect(result.errorCode).toBe('invalid')
    expect(db.insertNote).not.toHaveBeenCalled()
  })

  test('allows empty text on a time entry', async () => {
    vi.mocked(db.insertNote).mockResolvedValue(
      makeNote({ content: '', entity_id: null, entity_type: 'time' }),
    )
    const result = await addNote('user', {
      content: '',
      entity_type: 'time',
      start_time: '2024-01-01T08:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  test('stores the title trimmed, the tags normalised and the hashtags of the content; answers their union', async () => {
    vi.mocked(db.insertNote).mockImplementation(async (_user, type, id, content, start, end, extras) =>
      makeNote({
        content,
        end_time: end,
        entity_id: id,
        entity_type: type,
        hashtags: extras?.hashtags,
        start_time: start,
        tags: extras?.tags,
        title: extras?.title ?? undefined,
      }),
    )

    const result = await addNote('user', {
      content: 'Train to the coast #travel #Sea',
      entity_type: 'time',
      start_time: '2024-01-01T08:00:00.000Z',
      tags: ['#Family', 'travel'],
      title: '  Away  ',
    })

    expect(vi.mocked(db.insertNote).mock.calls[0]![6]).toEqual({
      hashtags: ['travel', 'sea'],
      tags: ['family', 'travel'],
      title: 'Away',
    })
    expect(result.data).toMatchObject({ tags: ['family', 'sea', 'travel'], title: 'Away' })
  })

  test('a reply under a day entry carries its date', async () => {
    const root = makeNote({ date: '2024-01-20', entity_id: null, entity_type: 'day' })
    vi.mocked(db.getNoteRoot).mockResolvedValue(root)
    vi.mocked(db.insertNote).mockResolvedValue(makeNote({ entity_id: root.id, entity_type: 'note' }))

    await addNote('user', { content: 'Me too', entity_id: root.id, entity_type: 'note' })

    expect(db.insertNote).toHaveBeenCalledWith('user', 'note', root.id, 'Me too', undefined, undefined, {
      date: '2024-01-20',
      hashtags: [],
    })
  })
})

describe('getNotesInRange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("nests each root comment's replies, oldest first", async () => {
    const rootId = randomUUID()
    const root = makeNote({ content: 'Root', entity_id: null, entity_type: 'time', id: rootId })
    vi.mocked(db.getNotesForTimeRange).mockResolvedValue([root])
    vi.mocked(db.getRepliesForRootIds).mockResolvedValue(
      new Map([
        [
          rootId,
          [
            makeNote({ content: 'First reply', entity_id: rootId, entity_type: 'note' }),
            makeNote({ content: 'Second reply', entity_id: rootId, entity_type: 'note' }),
          ],
        ],
      ]),
    )

    const from = new Date('2024-01-15T00:00:00Z')
    const to = new Date('2024-01-15T23:59:59Z')
    const result = await getNotesInRange('user', from, to)

    expect(db.getNotesForTimeRange).toHaveBeenCalledWith(
      'user',
      from,
      to,
      {
        from: '2024-01-15',
        to: '2024-01-16',
      },
      {},
    )
    expect(db.getRepliesForRootIds).toHaveBeenCalledWith('user', [rootId])
    expect(result).toHaveLength(1)
    expect(result[0].replies?.map((r) => r.content)).toEqual(['First reply', 'Second reply'])
  })

  test('reads the day notes on the local dates of the window in the given zone', async () => {
    vi.mocked(db.getNotesForTimeRange).mockResolvedValue([])
    const from = new Date('2024-01-14T23:00:00Z')
    const to = new Date('2024-01-15T22:59:59.999Z')

    await getNotesInRange('user', from, to, 'Europe/Stockholm')
    expect(db.getNotesForTimeRange).toHaveBeenCalledWith(
      'user',
      from,
      to,
      {
        from: '2024-01-15',
        to: '2024-01-15',
      },
      {},
    )

    await getNotesInRange('user', from, to, 'UTC')
    expect(db.getNotesForTimeRange).toHaveBeenLastCalledWith(
      'user',
      from,
      to,
      {
        from: '2024-01-14',
        to: '2024-01-15',
      },
      {},
    )
  })

  test('a window ending exactly at the next local midnight does not reach into the next day', async () => {
    vi.mocked(db.getNotesForTimeRange).mockResolvedValue([])
    const from = new Date('2024-01-14T23:00:00Z')
    const to = new Date('2024-01-15T23:00:00Z')

    await getNotesInRange('user', from, to, 'Europe/Stockholm')

    expect(vi.mocked(db.getNotesForTimeRange).mock.calls[0]![3]).toEqual({
      from: '2024-01-15',
      to: '2024-01-15',
    })
  })

  test('skips the reply lookup when the window has no comments', async () => {
    vi.mocked(db.getNotesForTimeRange).mockResolvedValue([])

    const result = await getNotesInRange('user', new Date(), new Date())

    expect(result).toEqual([])
    expect(db.getRepliesForRootIds).not.toHaveBeenCalled()
  })
})

const updated = (note: ReturnType<typeof makeNote>) => ({ note, status: 'updated' as const })

const REVISIONS = { limit: 50, min_interval_minutes: 10 }

describe('updateNote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getRepliesForRootIds).mockResolvedValue(new Map())
  })

  test('returns updated note with time fields', async () => {
    const noteId = randomUUID()
    const start = new Date('2024-01-15T08:00:00Z')
    const end = new Date('2024-01-15T09:00:00Z')
    const existing = makeNote({ end_time: end, entity_type: 'activity', id: noteId, start_time: start })

    vi.mocked(db.getNoteById).mockResolvedValue(existing)
    vi.mocked(db.updateNoteGuarded).mockResolvedValue(updated(existing))

    const result = await updateNote('user', noteId, { content: 'Updated content' })

    expect(db.updateNoteGuarded).toHaveBeenCalledWith(
      'user',
      noteId,
      { content: 'Updated content', hashtags: [] },
      { expected_updated_at: undefined, revisions: REVISIONS },
    )
    expect(result.success).toBe(true)
    expect(result.data?.start_time).toBe(start.toISOString())
    expect(result.data?.end_time).toBe(end.toISOString())
  })

  test('clears the end of a time comment when end_time is null', async () => {
    const noteId = randomUUID()
    const start = new Date('2024-01-15T08:00:00Z')
    const existing = makeNote({
      end_time: new Date('2024-01-15T09:00:00Z'),
      entity_id: null,
      entity_type: 'time',
      id: noteId,
      start_time: start,
    })

    vi.mocked(db.getNoteById).mockResolvedValue(existing)
    vi.mocked(db.updateNoteGuarded).mockResolvedValue(
      updated(
        makeNote({
          end_time: undefined,
          entity_id: null,
          entity_type: 'time',
          id: noteId,
          start_time: start,
        }),
      ),
    )

    const result = await updateNote('user', noteId, { end_time: null })

    expect(vi.mocked(db.updateNoteGuarded).mock.calls[0]![2]).toEqual({ end_time: null })
    expect(result.success).toBe(true)
    expect(result.data?.end_time).toBeUndefined()
  })

  test('refuses to edit a synced comment', async () => {
    const noteId = randomUUID()
    const existing = makeNote({
      entity_type: 'activity',
      id: noteId,
      source: 'health_connect',
    })

    vi.mocked(db.getNoteById).mockResolvedValue(existing)

    const result = await updateNote('user', noteId, { content: 'Mine now' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('synced source')
    expect(db.updateNoteGuarded).not.toHaveBeenCalled()
  })

  test('returns error when note not found', async () => {
    vi.mocked(db.getNoteById).mockResolvedValue(null)

    const result = await updateNote('user', randomUUID(), { content: 'Content' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Note not found')
    expect(db.updateNoteGuarded).not.toHaveBeenCalled()
  })

  test('rejects setting times on a note anchored to an entity', async () => {
    const noteId = randomUUID()
    vi.mocked(db.getNoteById).mockResolvedValue(makeNote({ entity_type: 'activity', id: noteId }))

    const result = await updateNote('user', noteId, { start_time: '2024-01-15T08:00:00.000Z' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Times can only be set on a time-anchored comment')
    expect(db.updateNoteGuarded).not.toHaveBeenCalled()
  })

  test('treats a non-UUID id as not found without querying', async () => {
    const result = await updateNote('user', 'not-a-uuid', { content: 'Content' })

    expect(result).toMatchObject({ errorCode: 'not_found', success: false })
    expect(db.getNoteById).not.toHaveBeenCalled()
  })

  test('returns errorCode not_found when the note does not exist', async () => {
    vi.mocked(db.getNoteById).mockResolvedValue(null)

    const result = await updateNote('user', randomUUID(), { content: 'Content' })

    expect(result.errorCode).toBe('not_found')
  })

  test('returns not_found when the note is deleted between the read and the write', async () => {
    vi.mocked(db.getNoteById).mockResolvedValue(makeNote({ entity_id: null, entity_type: 'time' }))
    vi.mocked(db.updateNoteGuarded).mockResolvedValue({ status: 'not_found' })

    const result = await updateNote('user', randomUUID(), { content: 'Content' })

    expect(result.errorCode).toBe('not_found')
  })

  test('rejects moving the end of a time comment before its start', async () => {
    const noteId = randomUUID()
    vi.mocked(db.getNoteById).mockResolvedValue(
      makeNote({
        entity_id: null,
        entity_type: 'time',
        id: noteId,
        start_time: new Date('2024-01-15T12:00:00Z'),
      }),
    )

    const result = await updateNote('user', noteId, { end_time: '2024-01-15T11:00:00.000Z' })

    expect(result).toMatchObject({
      error: 'end_time must not precede start_time',
      errorCode: 'invalid',
      success: false,
    })
    expect(db.updateNoteGuarded).not.toHaveBeenCalled()
  })

  test('rejects moving the start of a time comment past its end', async () => {
    const noteId = randomUUID()
    vi.mocked(db.getNoteById).mockResolvedValue(
      makeNote({
        end_time: new Date('2024-01-15T13:00:00Z'),
        entity_id: null,
        entity_type: 'time',
        id: noteId,
        start_time: new Date('2024-01-15T12:00:00Z'),
      }),
    )

    const result = await updateNote('user', noteId, { start_time: '2024-01-15T14:00:00.000Z' })

    expect(result.errorCode).toBe('invalid')
    expect(db.updateNoteGuarded).not.toHaveBeenCalled()
  })

  test('moves a time note; the db moves its replies with it', async () => {
    const noteId = randomUUID()
    const newStart = new Date('2024-01-15T11:00:00Z')
    vi.mocked(db.getNoteById).mockResolvedValue(
      makeNote({ entity_id: null, entity_type: 'time', id: noteId }),
    )
    vi.mocked(db.updateNoteGuarded).mockResolvedValue(
      updated(makeNote({ entity_id: null, entity_type: 'time', id: noteId, start_time: newStart })),
    )

    const result = await updateNote('user', noteId, { start_time: newStart.toISOString() })

    expect(result.success).toBe(true)
    expect(vi.mocked(db.updateNoteGuarded).mock.calls[0]![2]).toEqual({ start_time: newStart })
    expect(vi.mocked(db.updateNoteGuarded).mock.calls[0]![3]).toMatchObject({ expected_entity_type: 'time' })
  })

  test('a move that finds the entry switched to a day entry meanwhile answers a conflict', async () => {
    const noteId = randomUUID()
    vi.mocked(db.getNoteById).mockResolvedValue(
      makeNote({ entity_id: null, entity_type: 'time', id: noteId }),
    )
    vi.mocked(db.updateNoteGuarded).mockResolvedValue({
      note: makeNote({ date: '2024-01-15', entity_id: null, entity_type: 'day', id: noteId }),
      status: 'conflict',
    })

    const result = await updateNote('user', noteId, { start_time: '2024-01-15T11:00:00Z' })

    expect(result).toMatchObject({ data: { entity_type: 'day' }, errorCode: 'conflict', success: false })
  })

  test('a text-only edit does not pin the kind', async () => {
    const noteId = randomUUID()
    vi.mocked(db.getNoteById).mockResolvedValue(
      makeNote({ entity_id: null, entity_type: 'time', id: noteId }),
    )
    vi.mocked(db.updateNoteGuarded).mockResolvedValue(updated(makeNote({ id: noteId })))

    await updateNote('user', noteId, { content: 'x' })

    expect(vi.mocked(db.updateNoteGuarded).mock.calls[0]![3]).not.toHaveProperty('expected_entity_type')
  })

  test('a date makes a time note a day note, dropping its times', async () => {
    const noteId = randomUUID()
    vi.mocked(db.getNoteById).mockResolvedValue(
      makeNote({
        entity_id: null,
        entity_type: 'time',
        id: noteId,
        start_time: new Date('2024-01-15T11:00:00Z'),
      }),
    )
    vi.mocked(db.updateNoteGuarded).mockResolvedValue(
      updated(makeNote({ date: '2024-01-20', entity_id: null, entity_type: 'day', id: noteId })),
    )

    const result = await updateNote('user', noteId, { date: '2024-01-20' })

    expect(vi.mocked(db.updateNoteGuarded).mock.calls[0]![2]).toEqual({
      date: '2024-01-20',
      end_time: null,
      entity_type: 'day',
      start_time: null,
    })
    expect(result.data).toMatchObject({ date: '2024-01-20', entity_type: 'day' })
  })

  test('a start_time makes a day note a time note, dropping its date', async () => {
    const noteId = randomUUID()
    const start = new Date('2024-01-20T09:00:00Z')
    vi.mocked(db.getNoteById).mockResolvedValue(
      makeNote({ date: '2024-01-20', entity_id: null, entity_type: 'day', id: noteId }),
    )
    vi.mocked(db.updateNoteGuarded).mockResolvedValue(
      updated(makeNote({ entity_id: null, entity_type: 'time', id: noteId, start_time: start })),
    )

    await updateNote('user', noteId, { start_time: start.toISOString() })

    expect(vi.mocked(db.updateNoteGuarded).mock.calls[0]![2]).toEqual({
      date: null,
      end_time: null,
      entity_type: 'time',
      start_time: start,
    })
  })

  test.each([
    [
      'an end_time alone on a day note',
      { entity_type: 'day' as const },
      { end_time: '2024-01-20T09:00:00.000Z' },
    ],
    ['a date on an entity comment', { entity_type: 'activity' as const }, { date: '2024-01-20' }],
    [
      'a date with a start_time',
      { entity_type: 'time' as const },
      { date: '2024-01-20', start_time: '2024-01-20T09:00:00.000Z' },
    ],
    ['a date that is not on the calendar', { entity_type: 'time' as const }, { date: '2023-02-29' }],
    ['a title on a reply', { entity_type: 'note' as const }, { title: 'No' }],
    ['empty text on an entity comment', { entity_type: 'activity' as const }, { content: '' }],
    ['an invalid tag', { entity_type: 'time' as const }, { tags: ['not a tag'] }],
    ['a title over 200 characters', { entity_type: 'time' as const }, { title: 'x'.repeat(201) }],
  ])('refuses %s', async (_label, shape, fields) => {
    vi.mocked(db.getNoteById).mockResolvedValue(makeNote({ entity_id: null, ...shape }))

    const result = await updateNote('user', randomUUID(), fields)

    expect(result.errorCode).toBe('invalid')
    expect(db.updateNoteGuarded).not.toHaveBeenCalled()
  })

  test('allows empty text on a free-standing entry', async () => {
    const note = makeNote({ entity_id: null, entity_type: 'day', date: '2024-01-20' })
    vi.mocked(db.getNoteById).mockResolvedValue(note)
    vi.mocked(db.updateNoteGuarded).mockResolvedValue(updated({ ...note, content: '' }))

    const result = await updateNote('user', note.id, { content: '' })

    expect(result.success).toBe(true)
  })

  test('normalises the title and tags, and recomputes the hashtags from new content', async () => {
    const note = makeNote({ entity_id: null, entity_type: 'time' })
    vi.mocked(db.getNoteById).mockResolvedValue(note)
    vi.mocked(db.updateNoteGuarded).mockResolvedValue(
      updated({ ...note, hashtags: ['run', 'family'], tags: ['travel', 'family'], title: 'Trip' }),
    )

    const result = await updateNote('user', note.id, {
      content: 'Out for a #Run with the #family',
      tags: ['#Travel', 'family', 'travel'],
      title: '  Trip  ',
    })

    expect(vi.mocked(db.updateNoteGuarded).mock.calls[0]![2]).toEqual({
      content: 'Out for a #Run with the #family',
      hashtags: ['run', 'family'],
      tags: ['travel', 'family'],
      title: 'Trip',
    })
    expect(result.data?.tags).toEqual(['family', 'run', 'travel'])
    expect(result.data?.title).toBe('Trip')
  })

  test('null or a blank title clears it', async () => {
    const note = makeNote({ entity_id: null, entity_type: 'time', title: 'Old' })
    vi.mocked(db.getNoteById).mockResolvedValue(note)
    vi.mocked(db.updateNoteGuarded).mockResolvedValue(updated(note))

    await updateNote('user', note.id, { title: null })
    await updateNote('user', note.id, { title: '   ' })

    expect(vi.mocked(db.updateNoteGuarded).mock.calls.map((call) => call[2].title)).toEqual([null, null])
  })

  test('passes expected_updated_at and answers a conflict with the current note', async () => {
    const note = makeNote({ content: 'Changed elsewhere', entity_id: null, entity_type: 'time' })
    vi.mocked(db.getNoteById).mockResolvedValue(note)
    vi.mocked(db.updateNoteGuarded).mockResolvedValue({ note, status: 'conflict' })

    const result = await updateNote('user', note.id, {
      content: 'Mine',
      expected_updated_at: '2024-01-15T09:00:00.000Z',
    })

    expect(vi.mocked(db.updateNoteGuarded).mock.calls[0]![3]).toEqual({
      expected_updated_at: new Date('2024-01-15T09:00:00.000Z'),
      revisions: REVISIONS,
    })
    expect(result).toMatchObject({
      data: { content: 'Changed elsewhere' },
      error: 'This comment was changed elsewhere',
      errorCode: 'conflict',
      success: false,
    })
  })

  test('a matching expected_updated_at writes', async () => {
    const note = makeNote({ entity_id: null, entity_type: 'time' })
    vi.mocked(db.getNoteById).mockResolvedValue(note)
    vi.mocked(db.updateNoteGuarded).mockResolvedValue(updated({ ...note, content: 'Mine' }))

    const result = await updateNote('user', note.id, {
      content: 'Mine',
      expected_updated_at: note.updated_at.toISOString(),
    })

    expect(result).toMatchObject({ data: { content: 'Mine' }, success: true })
  })

  test('keeps revisions by the exported policy: 10 minutes apart, the latest 50', async () => {
    const { NOTE_REVISION_LIMIT, NOTE_REVISION_MIN_INTERVAL_MINUTES } = await import('@aurboda/api-spec')
    expect(NOTE_REVISION_LIMIT).toBe(50)
    expect(NOTE_REVISION_MIN_INTERVAL_MINUTES).toBe(10)
  })
})

describe('deleteNoteById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('soft-deletes by default', async () => {
    vi.mocked(db.softDeleteNote).mockResolvedValue(true)
    const result = await deleteNoteById('user', randomUUID())
    expect(result).toEqual({ deleted: true, success: true })
    expect(db.deleteNote).not.toHaveBeenCalled()
  })

  test('removes for good with purge', async () => {
    vi.mocked(db.deleteNote).mockResolvedValue(true)
    const id = randomUUID()
    const result = await deleteNoteById('user', id, { purge: true })
    expect(result).toEqual({ deleted: true, success: true })
    expect(db.deleteNote).toHaveBeenCalledWith('user', id)
    expect(db.softDeleteNote).not.toHaveBeenCalled()
  })

  test('returns success=false and deleted=false when note not found', async () => {
    vi.mocked(db.softDeleteNote).mockResolvedValue(false)
    const result = await deleteNoteById('user', randomUUID())
    expect(result).toEqual({ deleted: false, success: false })
  })

  test('treats a non-UUID id as not found without querying', async () => {
    const result = await deleteNoteById('user', 'not-a-uuid')
    expect(result).toEqual({ deleted: false, success: false })
    expect(db.deleteNote).not.toHaveBeenCalled()
    expect(db.softDeleteNote).not.toHaveBeenCalled()
  })
})

describe('restoreNoteById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getRepliesForRootIds).mockResolvedValue(new Map())
  })

  test('answers the restored root with its replies', async () => {
    const root = makeNote({ entity_id: null, entity_type: 'time' })
    vi.mocked(db.restoreNote).mockResolvedValue({ note: root, status: 'restored' })
    vi.mocked(db.getRepliesForRootIds).mockResolvedValue(
      new Map([[root.id, [makeNote({ content: 'Back too', entity_id: root.id, entity_type: 'note' })]]]),
    )

    const result = await restoreNoteById('user', root.id)

    expect(result.success).toBe(true)
    expect(result.data?.replies?.map((r) => r.content)).toEqual(['Back too'])
  })

  test('a reply under a deleted root is a conflict', async () => {
    vi.mocked(db.restoreNote).mockResolvedValue({ status: 'root_deleted' })
    const result = await restoreNoteById('user', randomUUID())
    expect(result).toMatchObject({
      error: 'Restore the comment it replies to first',
      errorCode: 'conflict',
      success: false,
    })
  })

  test('unknown is not found', async () => {
    vi.mocked(db.restoreNote).mockResolvedValue({ status: 'not_found' })
    expect((await restoreNoteById('user', randomUUID())).errorCode).toBe('not_found')
    expect((await restoreNoteById('user', 'nope')).errorCode).toBe('not_found')
  })
})

describe('listDeletedNotes', () => {
  test('gives each its deleted_at and purge_at, 30 days later', async () => {
    const deletedAt = new Date('2024-03-01T10:00:00Z')
    const root = makeNote({ deleted_at: deletedAt, entity_id: null, entity_type: 'time' })
    const reply = makeNote({ deleted_at: deletedAt, entity_id: root.id, entity_type: 'note' })
    vi.mocked(db.getDeletedNotes).mockResolvedValue([{ note: root, replies: [reply] }])

    const [data] = await listDeletedNotes('user')

    expect(data).toMatchObject({
      deleted_at: '2024-03-01T10:00:00.000Z',
      purge_at: '2024-03-31T10:00:00.000Z',
      replies: [{ deleted_at: '2024-03-01T10:00:00.000Z', id: reply.id }],
    })
  })
})

describe('getNoteForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('answers a thread root with its replies and an entry with its attachments', async () => {
    const root = makeNote({ entity_id: null, entity_type: 'day', date: '2024-01-15' })
    const reply = makeNote({ content: 'Reply', entity_id: root.id, entity_type: 'note' })
    vi.mocked(db.getNoteById).mockResolvedValue(root)
    vi.mocked(db.getRepliesForRootIds).mockResolvedValue(new Map([[root.id, [reply]]]))

    const result = await getNoteForUser('user', root.id)

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ attachments: [], date: '2024-01-15', id: root.id })
    expect(result.data?.replies).toHaveLength(1)
  })

  test('answers a reply on its own', async () => {
    const reply = makeNote({ entity_type: 'note' })
    vi.mocked(db.getNoteById).mockResolvedValue(reply)

    const result = await getNoteForUser('user', reply.id)

    expect(result.data).toMatchObject({ entity_type: 'note', id: reply.id })
    expect(db.getRepliesForRootIds).not.toHaveBeenCalled()
  })

  test('a missing, deleted or malformed id is not found', async () => {
    vi.mocked(db.getNoteById).mockResolvedValue(null)
    expect(await getNoteForUser('user', randomUUID())).toMatchObject({
      errorCode: 'not_found',
      success: false,
    })
    expect(await getNoteForUser('user', 'nope')).toMatchObject({ errorCode: 'not_found', success: false })
  })
})

describe('getNoteRevisionsById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('lists the revisions of a live note', async () => {
    const note = makeNote()
    vi.mocked(db.getNoteById).mockResolvedValue(note)
    vi.mocked(db.getNoteRevisions).mockResolvedValue([
      { content: 'Before', id: randomUUID(), note_id: note.id, saved_at: new Date('2024-01-15T10:00:00Z') },
    ])

    const result = await getNoteRevisionsById('user', note.id)

    expect(result).toMatchObject({
      data: [{ content: 'Before', saved_at: '2024-01-15T10:00:00.000Z' }],
      success: true,
    })
  })

  test('a missing or deleted note is not found', async () => {
    vi.mocked(db.getNoteById).mockResolvedValue(null)
    expect((await getNoteRevisionsById('user', randomUUID())).success).toBe(false)
    expect(db.getNoteRevisions).not.toHaveBeenCalled()
  })
})

describe('splitSearchText', () => {
  test.each([
    ['', undefined],
    ['  ', undefined],
    ['river', { prefix: 'river', websearch: '' }],
    ['walked River', { prefix: 'river', websearch: 'walked' }],
    ['"along the river"', { websearch: '"along the river"' }],
    ['walk -river', { websearch: 'walk -river' }],
    ['walk or run', { websearch: 'walk or run' }],
    ['walk or', { websearch: 'walk or' }],
  ])('%j', (q, expected) => {
    expect(splitSearchText(q)).toEqual(expected)
  })
})

describe('onThisDayFilter', () => {
  test('the same month and day in earlier years', () => {
    expect(onThisDayFilter('2026-07-04')).toEqual({ before_year: 2026, month_days: ['07-04'] })
  })

  test('28 February of a non-leap year takes 29 February too', () => {
    expect(onThisDayFilter('2026-02-28')).toEqual({ before_year: 2026, month_days: ['02-28', '02-29'] })
    expect(onThisDayFilter('2028-02-28')).toEqual({ before_year: 2028, month_days: ['02-28'] })
    expect(onThisDayFilter('2028-02-29')).toEqual({ before_year: 2028, month_days: ['02-29'] })
  })
})

describe('notes search cursor', () => {
  test('round-trips', () => {
    const cursor = {
      anchor: '2024-01-15T08:00:00.123456Z',
      created_at: '2024-01-15T09:00:00.000001Z',
      id: randomUUID(),
    }
    expect(decodeNotesCursor(encodeNotesCursor(cursor))).toEqual(cursor)
  })

  test.each([
    'garbage',
    Buffer.from('[1,2,3]').toString('base64url'),
    Buffer.from('{}').toString('base64url'),
  ])('refuses %s', (raw) => {
    expect(decodeNotesCursor(raw)).toBeNull()
  })
})

describe('searchNotesForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getRepliesForRootIds).mockResolvedValue(new Map())
    vi.mocked(db.searchNotes).mockResolvedValue({ next_cursor: null, notes: [] })
  })

  test('defaults to the free-standing entries, 50 at a time, in the user’s zone', async () => {
    const result = await searchNotesForUser('user', {})
    expect(result).toEqual({ data: [], next_cursor: null, success: true })
    expect(db.searchNotes).toHaveBeenCalledWith('user', {
      cursor: undefined,
      entity_types: ['time', 'day'],
      from: undefined,
      limit: 50,
      on_this_day: undefined,
      tags: [],
      text: undefined,
      to: undefined,
      tz: 'Europe/Stockholm',
    })
  })

  test('passes every filter through, parsed', async () => {
    const cursor = {
      anchor: '2024-01-15T08:00:00.000000Z',
      created_at: '2024-01-15T08:00:00.000000Z',
      id: randomUUID(),
    }
    await searchNotesForUser('user', {
      cursor: encodeNotesCursor(cursor),
      entity_types: 'time, activity',
      from: '2024-01-01',
      limit: 500,
      on_this_day: '2025-02-28',
      q: 'long walk',
      tags: '#Travel,family',
      to: '2024-12-31',
      tz: 'UTC',
    })
    expect(db.searchNotes).toHaveBeenCalledWith('user', {
      cursor,
      entity_types: ['time', 'activity'],
      from: '2024-01-01',
      limit: 200,
      on_this_day: { before_year: 2025, month_days: ['02-28', '02-29'] },
      tags: ['travel', 'family'],
      text: { prefix: 'walk', websearch: 'long' },
      to: '2024-12-31',
      tz: 'UTC',
    })
  })

  test('encodes the next cursor and nests replies', async () => {
    const root = makeNote({ entity_id: null, entity_type: 'time' })
    const next = {
      anchor: '2024-01-15T08:00:00.000000Z',
      created_at: '2024-01-15T08:00:00.000000Z',
      id: root.id,
    }
    vi.mocked(db.searchNotes).mockResolvedValue({ next_cursor: next, notes: [root] })

    const result = await searchNotesForUser('user', {})

    expect(result.success && decodeNotesCursor(result.next_cursor!)).toEqual(next)
    expect(result.success && result.data[0]!.replies).toEqual([])
  })

  test.each([
    ['replies as a root type', { entity_types: 'note' }],
    ['an unknown type', { entity_types: 'time,banana' }],
    ['an invalid tag', { tags: 'not a tag' }],
    ['a broken cursor', { cursor: 'x' }],
    ['a date off the calendar', { from: '2023-02-29' }],
    ['to before from', { from: '2024-02-01', to: '2024-01-01' }],
  ])('refuses %s', async (_label, input) => {
    const result = await searchNotesForUser('user', input)
    expect(result.success).toBe(false)
    expect(db.searchNotes).not.toHaveBeenCalled()
  })
})

describe('getNotesForEntity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getRepliesForRootIds).mockResolvedValue(new Map())
  })

  test('maps notes to serialized format including time fields', async () => {
    const entityId = randomUUID()
    const start = new Date('2024-01-15T08:00:00Z')
    const end = new Date('2024-01-15T09:00:00Z')

    vi.mocked(db.getNotesForEntity).mockResolvedValue([
      makeNote({ content: 'Note 1', end_time: end, entity_id: entityId, start_time: start }),
      makeNote({ content: 'Note 2', entity_id: entityId }),
    ])

    const result = await getNotesForEntity('user', 'activity', entityId)

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('Note 1')
    expect(result[0].start_time).toBe(start.toISOString())
    expect(result[0].end_time).toBe(end.toISOString())
    expect(result[1].content).toBe('Note 2')
    expect(result[1].start_time).toBeUndefined()
    expect(result[1].end_time).toBeUndefined()
  })

  test('returns empty array when no notes exist', async () => {
    vi.mocked(db.getNotesForEntity).mockResolvedValue([])
    const result = await getNotesForEntity('user', 'activity', randomUUID())
    expect(result).toEqual([])
  })

  test('reads the notes about a live person', async () => {
    const personId = randomUUID()
    vi.mocked(db.getPerson).mockResolvedValue({ id: personId } as db.PersonRecord)
    vi.mocked(db.getNotesForEntity).mockResolvedValue([
      makeNote({ entity_id: personId, entity_type: 'person' }),
    ])
    expect(await getNotesForEntity('user', 'person', personId)).toHaveLength(1)
    expect(db.getPerson).toHaveBeenCalledWith('user', personId)
  })

  test('a deleted or unknown person has no notes, which stay stored', async () => {
    vi.mocked(db.getPerson).mockResolvedValue(null)
    expect(await getNotesForEntity('user', 'person', randomUUID())).toEqual([])
    expect(db.getNotesForEntity).not.toHaveBeenCalled()
  })

  test('a malformed person id has no notes and is never looked up', async () => {
    expect(await getNotesForEntity('user', 'person', 'not-a-uuid')).toEqual([])
    expect(db.getPerson).not.toHaveBeenCalled()
    expect(db.getNotesForEntity).not.toHaveBeenCalled()
  })
})

describe('syncNoteTimesForEntity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('delegates to dbUpdateNoteTimesForEntity', async () => {
    vi.mocked(db.updateNoteTimesForEntity).mockResolvedValue(undefined)

    const entityId = randomUUID()
    const start = new Date('2024-01-15T08:00:00Z')
    const end = new Date('2024-01-15T09:00:00Z')

    await syncNoteTimesForEntity('user', 'activity', entityId, start, end)

    expect(db.updateNoteTimesForEntity).toHaveBeenCalledWith('user', 'activity', entityId, start, end)
  })

  test('passes undefined end_time when not provided', async () => {
    vi.mocked(db.updateNoteTimesForEntity).mockResolvedValue(undefined)

    const entityId = randomUUID()
    const start = new Date('2024-01-15T08:00:00Z')

    await syncNoteTimesForEntity('user', 'activity', entityId, start)

    expect(db.updateNoteTimesForEntity).toHaveBeenCalledWith('user', 'activity', entityId, start, undefined)
  })
})

describe('journal entry attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getRepliesForRootIds).mockResolvedValue(new Map())
  })

  test('an entry carries its live attachments, a comment on an entity none, in one lookup', async () => {
    const entry = makeNote({ date: '2024-01-15', entity_id: null, entity_type: 'day' })
    const bare = makeNote({ date: '2024-01-15', entity_id: null, entity_type: 'day' })
    const comment = makeNote({ entity_type: 'activity', start_time: new Date('2024-01-15T10:00:00Z') })
    vi.mocked(db.getNotesForTimeRange).mockResolvedValue([entry, bare, comment])
    vi.mocked(db.getNoteAttachmentsForNoteIds).mockResolvedValue(
      new Map([
        [
          entry.id,
          [
            {
              created_at: new Date('2024-01-15T12:00:00Z'),
              height: 400,
              id: randomUUID(),
              kind: 'image' as const,
              mime: 'image/webp',
              note_id: entry.id,
              position: 1,
              size: 1234,
              width: 300,
            },
          ],
        ],
      ]),
    )

    const result = await getNotesInRange(
      'user',
      new Date('2024-01-15T00:00:00Z'),
      new Date('2024-01-15T23:59:59Z'),
      'UTC',
    )

    expect(db.getNoteAttachmentsForNoteIds).toHaveBeenCalledTimes(1)
    expect(db.getNoteAttachmentsForNoteIds).toHaveBeenCalledWith('user', [entry.id, bare.id])
    expect(result[0].attachments).toEqual([
      expect.objectContaining({ kind: 'image', mime: 'image/webp', position: 1, size: 1234 }),
    ])
    expect(result[1].attachments).toEqual([])
    expect(result[2].attachments).toBeUndefined()
  })

  test('needs_text reaches the range read and the search', async () => {
    vi.mocked(db.getNotesForTimeRange).mockResolvedValue([])
    vi.mocked(db.searchNotes).mockResolvedValue({ next_cursor: null, notes: [] })
    const from = new Date('2024-01-15T00:00:00Z')
    const to = new Date('2024-01-15T23:59:59Z')

    await getNotesInRange('user', from, to, 'UTC', { needs_text: true })
    expect(db.getNotesForTimeRange).toHaveBeenCalledWith(
      'user',
      from,
      to,
      { from: '2024-01-15', to: '2024-01-15' },
      { needs_text: true },
    )

    await searchNotesForUser('user', { needs_text: true, tz: 'UTC' })
    expect(db.searchNotes).toHaveBeenCalledWith('user', expect.objectContaining({ needs_text: true }))
  })
})

describe('related people and activities', () => {
  const ANNA = randomUUID()
  const WALK = randomUUID()
  const annaLink = { entity_id: ANNA, entity_type: 'person' as const }
  const walkLink = { entity_id: WALK, entity_type: 'activity' as const }
  const annaRecord = {
    activity_type: null,
    end_time: null,
    entity_id: ANNA,
    entity_type: 'person' as const,
    name: 'Anna',
    start_time: null,
  }
  const walkRecord = {
    activity_type: 'walking',
    end_time: new Date('2026-11-21T00:30:00Z'),
    entity_id: WALK,
    entity_type: 'activity' as const,
    name: 'Evening walk',
    start_time: new Date('2026-11-20T23:30:00Z'),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getRepliesForRootIds).mockResolvedValue(new Map())
    vi.mocked(db.getNoteLinksForNoteIds).mockResolvedValue(new Map())
    vi.mocked(db.listLiveLinkTargetIds).mockImplementation(async (_user, type) =>
      type === 'person' ? [ANNA] : [WALK],
    )
  })

  test('a new entry writes its links with it and answers them labelled, an activity with its local date', async () => {
    const note = makeNote({ date: '2026-11-20', entity_id: null, entity_type: 'day' })
    vi.mocked(db.insertNote).mockResolvedValue(note)
    vi.mocked(db.getNoteLinksForNoteIds).mockResolvedValue(new Map([[note.id, [annaRecord, walkRecord]]]))

    const result = await addNote('user', {
      content: '',
      date: '2026-11-20',
      entity_type: 'day',
      related: [annaLink, walkLink],
    })

    expect(db.listLiveLinkTargetIds).toHaveBeenCalledTimes(2)
    expect(db.listLiveLinkTargetIds).toHaveBeenCalledWith('user', 'person', [ANNA])
    expect(db.listLiveLinkTargetIds).toHaveBeenCalledWith('user', 'activity', [WALK])
    expect(vi.mocked(db.insertNote).mock.calls[0]![6]).toMatchObject({ related: [annaLink, walkLink] })
    expect(result.data?.related).toEqual([
      { entity_id: ANNA, entity_type: 'person', label: 'Anna' },
      {
        activity_type: 'walking',
        entity_id: WALK,
        entity_type: 'activity',
        label: 'Evening walk, 2026-11-21',
      },
    ])
  })

  test('a sleep is labelled with the day it ended, other activities with the day they started', () => {
    const sleep = {
      activity_type: 'sleep',
      end_time: new Date('2026-11-20T06:30:00Z'),
      name: 'Sleep',
      start_time: new Date('2026-11-19T22:30:00Z'),
    }
    expect(noteRelatedLabel(sleep, 'UTC')).toBe('Sleep, 2026-11-20')
    expect(noteRelatedLabel({ ...sleep, end_time: null }, 'UTC')).toBe('Sleep, 2026-11-19')
    expect(noteRelatedLabel({ ...sleep, activity_type: 'walking', name: 'Walk' }, 'UTC')).toBe(
      'Walk, 2026-11-19',
    )
    expect(noteRelatedLabel({ ...sleep, start_time: null, activity_type: null, name: 'Anna' }, 'UTC')).toBe(
      'Anna',
    )
  })

  test('without related a new entry answers an empty list and writes no links', async () => {
    const note = makeNote({ date: '2026-11-20', entity_id: null, entity_type: 'day' })
    vi.mocked(db.insertNote).mockResolvedValue(note)

    const result = await addNote('user', { content: '', date: '2026-11-20', entity_type: 'day' })

    expect(vi.mocked(db.insertNote).mock.calls[0]![6]).not.toHaveProperty('related')
    expect(db.listLiveLinkTargetIds).not.toHaveBeenCalled()
    expect(result.data?.related).toEqual([])
  })

  test('an unknown or deleted target is refused, naming it, and nothing is written', async () => {
    const missing = randomUUID()
    const result = await addNote('user', {
      content: 'x',
      entity_type: 'time',
      related: [annaLink, { entity_id: missing, entity_type: 'activity' }],
      start_time: '2026-11-20T10:00:00Z',
    })

    expect(result).toMatchObject({
      error: `Unknown activity: ${missing}`,
      errorCode: 'invalid',
      success: false,
    })
    expect(db.insertNote).not.toHaveBeenCalled()

    const person = await addNote('user', {
      content: 'x',
      entity_type: 'time',
      related: [{ entity_id: missing, entity_type: 'person' }],
      start_time: '2026-11-20T10:00:00Z',
    })
    expect(person.error).toBe(`Unknown person: ${missing}`)
  })

  test('a reply cannot be related, on create or update', async () => {
    const created = await addNote('user', {
      content: 'Reply',
      entity_id: randomUUID(),
      entity_type: 'note',
      related: [annaLink],
    })
    expect(created).toMatchObject({ error: NOTE_REPLY_RELATED_ERROR, errorCode: 'invalid' })

    const reply = makeNote({ entity_type: 'note' })
    vi.mocked(db.getNoteById).mockResolvedValue(reply)
    const updatedReply = await updateNote('user', reply.id, { related: [] })
    expect(updatedReply).toMatchObject({ error: NOTE_REPLY_RELATED_ERROR, errorCode: 'invalid' })
    expect(db.updateNoteGuarded).not.toHaveBeenCalled()
  })

  test('an update passes the full list, [] to remove them all, and absent to leave them', async () => {
    const note = makeNote({
      entity_id: null,
      entity_type: 'time',
      start_time: new Date('2026-11-20T10:00:00Z'),
    })
    vi.mocked(db.getNoteById).mockResolvedValue(note)
    vi.mocked(db.updateNoteGuarded).mockResolvedValue({ note, status: 'updated' })

    await updateNote('user', note.id, { related: [annaLink] })
    expect(vi.mocked(db.updateNoteGuarded).mock.calls[0]![2]).toEqual({ related: [annaLink] })

    await updateNote('user', note.id, { related: [] })
    expect(vi.mocked(db.updateNoteGuarded).mock.calls[1]![2]).toEqual({ related: [] })

    await updateNote('user', note.id, { content: 'Text only' })
    expect(vi.mocked(db.updateNoteGuarded).mock.calls[2]![2].related).toBeUndefined()
  })

  test('a links-only change follows expected_updated_at: a stale one is a conflict', async () => {
    const note = makeNote({
      entity_id: null,
      entity_type: 'time',
      start_time: new Date('2026-11-20T10:00:00Z'),
    })
    vi.mocked(db.getNoteById).mockResolvedValue(note)
    vi.mocked(db.updateNoteGuarded).mockResolvedValue({ note, status: 'conflict' })

    const result = await updateNote('user', note.id, {
      expected_updated_at: '2026-11-20T09:00:00.000Z',
      related: [annaLink],
    })

    expect(vi.mocked(db.updateNoteGuarded).mock.calls[0]![3]).toMatchObject({
      expected_updated_at: new Date('2026-11-20T09:00:00.000Z'),
    })
    expect(result).toMatchObject({ data: { related: [] }, errorCode: 'conflict', success: false })
  })

  test('an unknown target on update is refused before anything is written', async () => {
    const note = makeNote({
      entity_id: null,
      entity_type: 'time',
      start_time: new Date('2026-11-20T10:00:00Z'),
    })
    vi.mocked(db.getNoteById).mockResolvedValue(note)
    const missing = randomUUID()

    const result = await updateNote('user', note.id, {
      related: [{ entity_id: missing, entity_type: 'person' }],
    })

    expect(result).toMatchObject({ error: `Unknown person: ${missing}`, errorCode: 'invalid' })
    expect(db.updateNoteGuarded).not.toHaveBeenCalled()
  })

  test('reads carry the links of the roots in one lookup, none for a reply', async () => {
    const entry = makeNote({ date: '2026-11-20', entity_id: null, entity_type: 'day' })
    const comment = makeNote({ entity_type: 'activity', start_time: new Date('2026-11-20T10:00:00Z') })
    vi.mocked(db.getNotesForTimeRange).mockResolvedValue([entry, comment])
    vi.mocked(db.getNoteLinksForNoteIds).mockResolvedValue(new Map([[entry.id, [annaRecord]]]))

    const result = await getNotesInRange(
      'user',
      new Date('2026-11-20T00:00:00Z'),
      new Date('2026-11-20T23:59:59Z'),
      'UTC',
    )

    expect(db.getNoteLinksForNoteIds).toHaveBeenCalledTimes(1)
    expect(db.getNoteLinksForNoteIds).toHaveBeenCalledWith('user', [entry.id, comment.id])
    expect(result[0].related).toEqual([{ entity_id: ANNA, entity_type: 'person', label: 'Anna' }])
    expect(result[1].related).toEqual([])
    expect(result[0].replies?.every((r) => !('related' in r))).toBe(true)
  })

  test('search passes the related filter; one without the other is refused', async () => {
    vi.mocked(db.searchNotes).mockResolvedValue({ next_cursor: null, notes: [] })

    await searchNotesForUser('user', { related_id: ANNA, related_type: 'person', tz: 'UTC' })
    expect(db.searchNotes).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({ related: { entity_id: ANNA, entity_type: 'person' } }),
    )

    expect(await searchNotesForUser('user', { related_type: 'person' })).toEqual({
      error: NOTES_SEARCH_RELATED_PAIR_ERROR,
      errorCode: 'invalid',
      success: false,
    })
    expect(await searchNotesForUser('user', { related_id: ANNA })).toMatchObject({ success: false })
  })

  test('listJournalEntryRefs lists the related notes with an excerpt of their first line', async () => {
    const id = randomUUID()
    vi.mocked(db.listNotesRelatedTo).mockResolvedValue([
      {
        content: `\n  \n  ${'x'.repeat(250)}\nSecond line`,
        date: '2026-11-20',
        entity_type: 'day',
        id,
        start_time: null,
        title: 'Saturday',
      },
    ])

    const refs = await listJournalEntryRefs('user', 'activity', [WALK, ANNA])

    expect(db.listNotesRelatedTo).toHaveBeenCalledWith(
      'user',
      'activity',
      [WALK, ANNA],
      50,
      'Europe/Stockholm',
    )
    expect(refs).toEqual([
      {
        date: '2026-11-20',
        entity_type: 'day',
        excerpt: 'x'.repeat(200),
        id,
        start_time: undefined,
        title: 'Saturday',
      },
    ])
  })

  test('journalExcerpt is the first non-empty line, trimmed', () => {
    expect(journalExcerpt('')).toBe('')
    expect(journalExcerpt('\n\n  Hello  \nWorld')).toBe('Hello')
  })

  test('journalExcerpt skips lines that are only pictures', () => {
    const id = '3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c'
    expect(
      journalExcerpt(`![](attachment:${id})\n ![lake](https://x/y.png) ![](attachment:${id})\nThe lake`),
    ).toBe('The lake')
    expect(journalExcerpt(`Look ![](attachment:${id})`)).toBe(`Look ![](attachment:${id})`)
    expect(journalExcerpt(`![](attachment:${id})`)).toBe('')
  })
})

describe('journal neighbours', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('toNoteNeighbor: a day entry carries its date, a timed one its start time, a blank title none', () => {
    const id = randomUUID()
    expect(
      toNoteNeighbor(
        makeNote({
          content: '\n  First line  \nSecond',
          date: '2024-01-15',
          entity_id: null,
          entity_type: 'day',
          id,
          title: 'Monday',
        }),
      ),
    ).toEqual({ date: '2024-01-15', entity_type: 'day', excerpt: 'First line', id, title: 'Monday' })

    expect(
      toNoteNeighbor(
        makeNote({
          content: '',
          entity_id: null,
          entity_type: 'time',
          id,
          start_time: new Date('2024-01-15T08:00:00Z'),
          title: '',
        }),
      ),
    ).toEqual({ entity_type: 'time', excerpt: '', id, start_time: '2024-01-15T08:00:00.000Z' })
  })

  test("reads the free-standing entries in the user's zone unless one is given", async () => {
    const older = makeNote({ content: 'Older', entity_id: null, entity_type: 'time', start_time: new Date() })
    vi.mocked(db.getNoteNeighbors).mockResolvedValue({ next: null, previous: older })

    const found = await getJournalNeighbors('user', 'id')
    expect(found).toEqual({ next: undefined, previous: toNoteNeighbor(older) })
    expect(db.getNoteNeighbors).toHaveBeenCalledWith('user', 'id', {
      entity_types: ['time', 'day'],
      tz: 'Europe/Stockholm',
    })

    await getJournalNeighbors('user', 'id', 'UTC')
    expect(db.getNoteNeighbors).toHaveBeenLastCalledWith('user', 'id', {
      entity_types: ['time', 'day'],
      tz: 'UTC',
    })
  })

  test('null when the entry is not a live Journal entry', async () => {
    vi.mocked(db.getNoteNeighbors).mockResolvedValue(null)
    expect(await getJournalNeighbors('user', 'id')).toBeNull()
  })
})

describe('mergeTagsInNote', () => {
  const merge = (content: string, tags: string[] = [], from = ['running'], into = 'run') =>
    mergeTagsInNote({ content, tags }, from, into)

  test('rewrites a hashtag at the start, in the middle and at the end', () => {
    expect(merge('#running today')?.content).toBe('#run today')
    expect(merge('Went #running, then home')?.content).toBe('Went #run, then home')
    expect(merge('Good day #running')?.content).toBe('Good day #run')
  })

  test('rewrites every occurrence, whatever its casing', () => {
    expect(merge('#Running and #running and #RUNNING')?.content).toBe('#run and #run and #run')
  })

  test('leaves tags in a URL or in code alone', () => {
    expect(merge('See https://example.com/#running and `#running` but #running')?.content).toBe(
      'See https://example.com/#running and `#running` but #run',
    )
    expect(merge('Only https://example.com/#running')).toBeNull()
  })

  test('leaves longer tags that start with the same letters alone', () => {
    expect(merge('#runningshoes')).toBeNull()
  })

  test('replaces explicit tags, deduplicating and keeping their order', () => {
    expect(merge('No hashtags', ['travel', 'running', 'family'])).toEqual({
      content: 'No hashtags',
      tags: ['travel', 'run', 'family'],
    })
    expect(merge('Text', ['run', 'running'])).toEqual({ content: 'Text', tags: ['run'] })
  })

  test('merges several tags at once, into a tag already in the text', () => {
    expect(merge('#jog then #run and #running', ['jog'], ['jog', 'running'], 'run')).toEqual({
      content: '#run then #run and #run',
      tags: ['run'],
    })
  })

  test('changes both the explicit tags and the text', () => {
    expect(merge('A #running day', ['running'])).toEqual({ content: 'A #run day', tags: ['run'] })
  })

  test('null when nothing carries a from tag', () => {
    expect(merge('A #walking day', ['walking'])).toBeNull()
  })
})

describe('listNoteTagsForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("lists the free-standing entries' tags in the user's zone by default", async () => {
    vi.mocked(db.listNoteTags).mockResolvedValue([
      { count: 2, last_used: new Date('2024-01-15T08:00:00Z'), tag: 'run' },
    ])
    expect(await listNoteTagsForUser('user', {})).toEqual({
      data: [{ count: 2, last_used: '2024-01-15T08:00:00.000Z', tag: 'run' }],
      success: true,
    })
    expect(db.listNoteTags).toHaveBeenCalledWith('user', {
      entity_types: ['time', 'day'],
      tz: 'Europe/Stockholm',
    })
  })

  test('passes the entity types and zone given', async () => {
    vi.mocked(db.listNoteTags).mockResolvedValue([])
    await listNoteTagsForUser('user', { entity_types: 'time,activity', tz: 'UTC' })
    expect(db.listNoteTags).toHaveBeenCalledWith('user', { entity_types: ['time', 'activity'], tz: 'UTC' })
  })

  test('refuses an entity type that is not a root type', async () => {
    expect(await listNoteTagsForUser('user', { entity_types: 'note' })).toMatchObject({
      errorCode: 'invalid',
      success: false,
    })
    expect(db.listNoteTags).not.toHaveBeenCalled()
  })
})

describe('mergeNoteTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('updates each carrying note through updateNote, always keeping a revision', async () => {
    const byHashtag = makeNote({ content: 'A #running day', hashtags: ['running'], tags: [] })
    const byTag = makeNote({ content: 'Plain', hashtags: [], tags: ['running', 'travel'] })
    const stale = makeNote({ content: 'No tag here', hashtags: ['running'], tags: [] })
    vi.mocked(db.getNotesWithAnyTag).mockResolvedValue([byHashtag, byTag, stale])
    vi.mocked(db.getNoteById).mockImplementation(
      async (_user, id) => [byHashtag, byTag, stale].find((note) => note.id === id) ?? null,
    )
    vi.mocked(db.updateNoteGuarded).mockImplementation(async (_user, id) =>
      updated([byHashtag, byTag].find((note) => note.id === id)!),
    )

    expect(await mergeNoteTags('user', { from: ['#Running'], into: 'run' })).toEqual({
      data: { changed: 2 },
      success: true,
    })
    expect(db.getNotesWithAnyTag).toHaveBeenCalledWith('user', ['running'])
    const calls = vi.mocked(db.updateNoteGuarded).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0]![1]).toBe(byHashtag.id)
    expect(calls[0]![2]).toMatchObject({ content: 'A #run day', hashtags: ['run'], tags: [] })
    expect(calls[0]![3]).toMatchObject({
      expected_updated_at: undefined,
      revisions: { limit: 50, min_interval_minutes: 0 },
    })
    expect(calls[1]![1]).toBe(byTag.id)
    expect(calls[1]![2]).toEqual({ tags: ['run', 'travel'] })
  })

  test('does not count a note the update refuses (a synced one)', async () => {
    const synced = makeNote({ content: 'A #running day', hashtags: ['running'], source: 'oura', tags: [] })
    vi.mocked(db.getNotesWithAnyTag).mockResolvedValue([synced])
    vi.mocked(db.getNoteById).mockResolvedValue(synced)
    expect(await mergeNoteTags('user', { from: ['running'], into: 'run' })).toEqual({
      data: { changed: 0 },
      success: true,
    })
    expect(db.updateNoteGuarded).not.toHaveBeenCalled()
  })

  test('refuses into among from, or an invalid tag', async () => {
    expect(await mergeNoteTags('user', { from: ['run', 'jog'], into: '#Run' })).toMatchObject({
      errorCode: 'invalid',
      success: false,
    })
    expect(await mergeNoteTags('user', { from: ['run'], into: '123' })).toMatchObject({ success: false })
    expect(db.getNotesWithAnyTag).not.toHaveBeenCalled()
  })
})
