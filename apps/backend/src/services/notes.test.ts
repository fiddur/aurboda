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
  syncNoteTimesForEntity,
  updateNoteContent,
} from './notes.ts'

vi.mock('../db', () => ({
  deleteNote: vi.fn(),
  getActivityById: vi.fn(),
  getNotesForEntity: vi.fn(),
  getProductivityById: vi.fn(),
  getReportById: vi.fn(),
  insertNote: vi.fn(),
  updateNote: vi.fn(),
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

describe('updateNoteContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns updated note with time fields', async () => {
    const noteId = randomUUID()
    const start = new Date('2024-01-15T08:00:00Z')
    const end = new Date('2024-01-15T09:00:00Z')

    vi.mocked(db.updateNote).mockResolvedValue(
      makeNote({ end_time: end, entity_type: 'activity', id: noteId, start_time: start }),
    )

    const result = await updateNoteContent('user', noteId, 'Updated content')

    expect(result.success).toBe(true)
    expect(result.data?.start_time).toBe(start.toISOString())
    expect(result.data?.end_time).toBe(end.toISOString())
  })

  test('returns error when note not found', async () => {
    vi.mocked(db.updateNote).mockResolvedValue(null)

    const result = await updateNoteContent('user', randomUUID(), 'Content')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Note not found')
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
