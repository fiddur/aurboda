/**
 * Unit tests for the notes service.
 * Tests time-inheritance logic (getEntityTimes) and all exported functions.
 */
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import {
  addNote,
  deleteNoteById,
  getNotesForEntity,
  getNotesInRange,
  syncNoteTimesForEntity,
  updateNote,
} from './notes.ts'

vi.mock('../db', () => ({
  deleteNote: vi.fn(),
  getActivityById: vi.fn(),
  getMealById: vi.fn(),
  getNoteById: vi.fn(),
  getNoteRoot: vi.fn(),
  getNotesForEntity: vi.fn(),
  getNotesForTimeRange: vi.fn(),
  getProductivityById: vi.fn(),
  getReportById: vi.fn(),
  getRepliesForRootIds: vi.fn(async () => new Map()),
  insertNote: vi.fn(),
  updateNoteFields: vi.fn(),
  updateNoteTimesForEntity: vi.fn(),
}))

const makeNote = (overrides = {}) => ({
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
    expect(db.insertNote).toHaveBeenCalledWith('user', 'activity', tagId, 'Great session', tagStart, tagEnd)
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

    expect(db.insertNote).toHaveBeenCalledWith('user', 'activity', tagId, 'Note', tagStart, undefined)
  })

  test('returns undefined times when tag entity not found', async () => {
    const tagId = randomUUID()
    vi.mocked(db.getActivityById).mockResolvedValue(null)

    const note = makeNote({ entity_id: tagId, entity_type: 'activity' })
    vi.mocked(db.insertNote).mockResolvedValue(note)

    await addNote('user', { content: 'Orphan note', entity_id: tagId, entity_type: 'activity' })

    expect(db.insertNote).toHaveBeenCalledWith('user', 'activity', tagId, 'Orphan note', undefined, undefined)
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
    expect(db.insertNote).toHaveBeenCalledWith('user', 'activity', activityId, 'Good run', start, end)
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
    expect(db.insertNote).toHaveBeenCalledWith('user', 'productivity', prodId, 'Focus session', start, end)
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
    )
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

    expect(db.insertNote).toHaveBeenCalledWith('user', 'time', null, 'Felt off around lunch', start, end)
    expect(result.success).toBe(true)
    expect(result.data?.entity_id).toBeNull()
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

  test('rejects a comment with no entity_id on an anchored type', async () => {
    const result = await addNote('user', { content: 'Nope', entity_type: 'activity' })

    expect(result.success).toBe(false)
    expect(result.error).toBe("entity_id is required unless entity_type is 'time'")
    expect(db.insertNote).not.toHaveBeenCalled()
  })

  test('replying to a reply re-anchors to the thread root', async () => {
    const rootId = randomUUID()
    const replyId = randomUUID()
    const rootStart = new Date('2024-01-15T12:00:00Z')
    const rootEnd = new Date('2024-01-15T12:30:00Z')

    // getNoteRoot resolves the reply to its root for us.
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
    expect(db.insertNote).toHaveBeenCalledWith('user', 'note', rootId, 'Me too', rootStart, rootEnd)
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
    expect(db.insertNote).toHaveBeenCalledWith('user', 'meal', mealId, 'Too salty', mealTime, undefined)
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

    expect(db.getNotesForTimeRange).toHaveBeenCalledWith('user', from, to)
    expect(db.getRepliesForRootIds).toHaveBeenCalledWith('user', [rootId])
    expect(result).toHaveLength(1)
    expect(result[0].replies?.map((r) => r.content)).toEqual(['First reply', 'Second reply'])
  })

  test('skips the reply lookup when the window has no comments', async () => {
    vi.mocked(db.getNotesForTimeRange).mockResolvedValue([])

    const result = await getNotesInRange('user', new Date(), new Date())

    expect(result).toEqual([])
    expect(db.getRepliesForRootIds).not.toHaveBeenCalled()
  })
})

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
    vi.mocked(db.updateNoteFields).mockResolvedValue(existing)

    const result = await updateNote('user', noteId, { content: 'Updated content' })

    expect(db.updateNoteFields).toHaveBeenCalledWith('user', noteId, {
      content: 'Updated content',
      end_time: undefined,
      start_time: undefined,
    })
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
    vi.mocked(db.updateNoteFields).mockResolvedValue(
      makeNote({ end_time: undefined, entity_id: null, entity_type: 'time', id: noteId, start_time: start }),
    )

    const result = await updateNote('user', noteId, { end_time: null })

    expect(db.updateNoteFields).toHaveBeenCalledWith('user', noteId, {
      content: undefined,
      end_time: null,
      start_time: undefined,
    })
    expect(result.success).toBe(true)
    expect(result.data?.end_time).toBeUndefined()
  })

  test('returns error when note not found', async () => {
    vi.mocked(db.getNoteById).mockResolvedValue(null)

    const result = await updateNote('user', randomUUID(), { content: 'Content' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Note not found')
    expect(db.updateNoteFields).not.toHaveBeenCalled()
  })

  test('rejects setting times on a note anchored to an entity', async () => {
    const noteId = randomUUID()
    vi.mocked(db.getNoteById).mockResolvedValue(makeNote({ entity_type: 'activity', id: noteId }))

    const result = await updateNote('user', noteId, { start_time: '2024-01-15T08:00:00.000Z' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Times can only be set on a time-anchored comment')
    expect(db.updateNoteFields).not.toHaveBeenCalled()
  })

  test('moves a time note and cascades the new times to its replies', async () => {
    const noteId = randomUUID()
    const newStart = new Date('2024-01-15T11:00:00Z')
    vi.mocked(db.getNoteById).mockResolvedValue(
      makeNote({ entity_id: null, entity_type: 'time', id: noteId }),
    )
    vi.mocked(db.updateNoteFields).mockResolvedValue(
      makeNote({ entity_id: null, entity_type: 'time', id: noteId, start_time: newStart }),
    )

    const result = await updateNote('user', noteId, { start_time: newStart.toISOString() })

    expect(result.success).toBe(true)
    expect(db.updateNoteFields).toHaveBeenCalledWith('user', noteId, {
      content: undefined,
      end_time: undefined,
      start_time: newStart,
    })
    expect(db.updateNoteTimesForEntity).toHaveBeenCalledWith('user', 'note', noteId, newStart, undefined)
  })
})

describe('deleteNoteById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns success and deleted=true when note exists', async () => {
    vi.mocked(db.deleteNote).mockResolvedValue(true)
    const result = await deleteNoteById('user', randomUUID())
    expect(result).toEqual({ deleted: true, success: true })
  })

  test('returns success=false and deleted=false when note not found', async () => {
    vi.mocked(db.deleteNote).mockResolvedValue(false)
    const result = await deleteNoteById('user', randomUUID())
    expect(result).toEqual({ deleted: false, success: false })
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
