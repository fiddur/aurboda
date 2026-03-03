import { randomUUID } from 'crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper'
import {
  deleteNote,
  getNoteById,
  getNotesByEntityIds,
  getNotesForEntity,
  getNotesForTimeRange,
  insertNote,
  updateNote,
  updateNoteTimesForEntity,
} from './notes'

const CONTAINER_TIMEOUT = 60_000

describe('Notes Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('insertNote', () => {
    test('creates a note and returns it with generated id', async () => {
      const user = getTestUser()
      const entityId = randomUUID()

      const note = await insertNote(user, 'activity', entityId, 'Great workout!')

      expect(note.id).toBeDefined()
      expect(note.entity_type).toBe('activity')
      expect(note.entity_id).toBe(entityId)
      expect(note.content).toBe('Great workout!')
      expect(note.created_at).toBeInstanceOf(Date)
      expect(note.updated_at).toBeInstanceOf(Date)
    })

    test('creates a note with inherited start_time and end_time', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const startTime = new Date('2024-01-15T08:15:00Z')
      const endTime = new Date('2024-01-15T08:45:00Z')

      const note = await insertNote(user, 'tag', entityId, 'Morning run', startTime, endTime)

      expect(note.start_time).toEqual(startTime)
      expect(note.end_time).toEqual(endTime)
    })

    test('creates a note with only start_time (point-in-time)', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const startTime = new Date('2024-01-15T09:00:00Z')

      const note = await insertNote(user, 'tag', entityId, 'Point in time note', startTime)

      expect(note.start_time).toEqual(startTime)
      expect(note.end_time).toBeUndefined()
    })

    test('creates a note without time fields (e.g. metric notes)', async () => {
      const user = getTestUser()
      const entityId = '2024-01-15T10:30:00.000Z|heart_rate|oura'

      const note = await insertNote(user, 'metric', entityId, 'HRV low today')

      expect(note.start_time).toBeUndefined()
      expect(note.end_time).toBeUndefined()
    })
  })

  describe('getNoteById', () => {
    test('retrieves note by ID', async () => {
      const user = getTestUser()
      const entityId = randomUUID()

      const created = await insertNote(user, 'tag', entityId, 'A note on a tag')
      const found = await getNoteById(user, created.id)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
      expect(found!.content).toBe('A note on a tag')
    })

    test('returns null for non-existent note', async () => {
      const user = getTestUser()
      const found = await getNoteById(user, randomUUID())
      expect(found).toBeNull()
    })
  })

  describe('getNotesForEntity', () => {
    test('returns all notes for an entity ordered by created_at', async () => {
      const user = getTestUser()
      const entityId = randomUUID()

      await insertNote(user, 'activity', entityId, 'First note')
      await insertNote(user, 'activity', entityId, 'Second note')

      const notes = await getNotesForEntity(user, 'activity', entityId)

      expect(notes).toHaveLength(2)
      expect(notes[0].content).toBe('First note')
      expect(notes[1].content).toBe('Second note')
    })

    test('returns empty array when no notes exist', async () => {
      const user = getTestUser()
      const notes = await getNotesForEntity(user, 'activity', randomUUID())
      expect(notes).toEqual([])
    })

    test('does not return notes for different entity', async () => {
      const user = getTestUser()
      const entityId1 = randomUUID()
      const entityId2 = randomUUID()

      await insertNote(user, 'activity', entityId1, 'Note for entity 1')
      await insertNote(user, 'activity', entityId2, 'Note for entity 2')

      const notes = await getNotesForEntity(user, 'activity', entityId1)

      expect(notes).toHaveLength(1)
      expect(notes[0].content).toBe('Note for entity 1')
    })
  })

  describe('updateNote', () => {
    test('updates note content and updated_at', async () => {
      const user = getTestUser()
      const entityId = randomUUID()

      const created = await insertNote(user, 'activity', entityId, 'Original content')
      const updated = await updateNote(user, created.id, 'Updated content')

      expect(updated).not.toBeNull()
      expect(updated!.content).toBe('Updated content')
      expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(created.updated_at.getTime())
    })

    test('returns null for non-existent note', async () => {
      const user = getTestUser()
      const updated = await updateNote(user, randomUUID(), 'New content')
      expect(updated).toBeNull()
    })
  })

  describe('updateNoteTimesForEntity', () => {
    test('updates start_time and end_time on all notes for an entity', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const initialStart = new Date('2024-01-15T08:00:00Z')
      const initialEnd = new Date('2024-01-15T08:30:00Z')

      const note1 = await insertNote(user, 'tag', entityId, 'First note', initialStart, initialEnd)
      const note2 = await insertNote(user, 'tag', entityId, 'Second note', initialStart, initialEnd)

      const newStart = new Date('2024-01-15T08:15:00Z')
      const newEnd = new Date('2024-01-15T09:00:00Z')
      await updateNoteTimesForEntity(user, 'tag', entityId, newStart, newEnd)

      const updatedNote1 = await getNoteById(user, note1.id)
      const updatedNote2 = await getNoteById(user, note2.id)

      expect(updatedNote1!.start_time).toEqual(newStart)
      expect(updatedNote1!.end_time).toEqual(newEnd)
      expect(updatedNote2!.start_time).toEqual(newStart)
      expect(updatedNote2!.end_time).toEqual(newEnd)
    })

    test('can clear end_time by passing undefined', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const start = new Date('2024-01-15T08:00:00Z')
      const end = new Date('2024-01-15T09:00:00Z')

      const note = await insertNote(user, 'tag', entityId, 'Has end time', start, end)
      expect(note.end_time).toBeDefined()

      await updateNoteTimesForEntity(user, 'tag', entityId, start, undefined)

      const updated = await getNoteById(user, note.id)
      expect(updated!.start_time).toEqual(start)
      expect(updated!.end_time).toBeUndefined()
    })

    test('does not affect notes on other entities', async () => {
      const user = getTestUser()
      const entityId1 = randomUUID()
      const entityId2 = randomUUID()
      const start = new Date('2024-01-15T08:00:00Z')

      const note1 = await insertNote(user, 'tag', entityId1, 'Entity 1 note', start)
      const note2 = await insertNote(user, 'tag', entityId2, 'Entity 2 note', start)

      const newStart = new Date('2024-01-15T10:00:00Z')
      await updateNoteTimesForEntity(user, 'tag', entityId1, newStart)

      const reloaded1 = await getNoteById(user, note1.id)
      const reloaded2 = await getNoteById(user, note2.id)

      expect(reloaded1!.start_time).toEqual(newStart)
      // Entity 2 note should be unchanged
      expect(reloaded2!.start_time).toEqual(start)
    })
  })

  describe('getNotesForTimeRange', () => {
    test('returns notes with time ranges overlapping the query window', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const start = new Date('2024-01-15T08:15:00Z')
      const end = new Date('2024-01-15T08:45:00Z')

      await insertNote(user, 'tag', entityId, 'In range', start, end)

      const results = await getNotesForTimeRange(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(results).toHaveLength(1)
      expect(results[0].content).toBe('In range')
    })

    test('returns note spanning multiple days when querying any overlapping day', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      // Long-spanning tag (e.g. a month)
      const monthStart = new Date('2024-01-01T00:00:00Z')
      const monthEnd = new Date('2024-01-31T23:59:59Z')

      await insertNote(user, 'tag', entityId, 'Long tag note', monthStart, monthEnd)

      // Query a day in the middle of the month
      const results = await getNotesForTimeRange(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(results).toHaveLength(1)
      expect(results[0].content).toBe('Long tag note')
    })

    test('excludes notes outside the query window', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      // Note is the day before
      await insertNote(
        user,
        'tag',
        entityId,
        'Yesterday',
        new Date('2024-01-14T10:00:00Z'),
        new Date('2024-01-14T11:00:00Z'),
      )

      const results = await getNotesForTimeRange(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(results).toHaveLength(0)
    })

    test('includes point-in-time notes (no end_time) within the window', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const pointInTime = new Date('2024-01-15T12:00:00Z')

      await insertNote(user, 'tag', entityId, 'Point-in-time note', pointInTime)

      const results = await getNotesForTimeRange(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(results).toHaveLength(1)
      expect(results[0].content).toBe('Point-in-time note')
    })

    test('excludes point-in-time notes outside the window', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const outsideTime = new Date('2024-01-16T12:00:00Z')

      await insertNote(user, 'tag', entityId, 'Outside', outsideTime)

      const results = await getNotesForTimeRange(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(results).toHaveLength(0)
    })

    test('excludes metric notes (no start_time)', async () => {
      const user = getTestUser()
      const metricEntityId = '2024-01-15T10:00:00.000Z|heart_rate|oura'

      await insertNote(user, 'metric', metricEntityId, 'Metric note')

      const results = await getNotesForTimeRange(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(results).toHaveLength(0)
    })

    test('returns notes sorted by start_time then created_at', async () => {
      const user = getTestUser()

      const laterStart = new Date('2024-01-15T14:00:00Z')
      const earlierStart = new Date('2024-01-15T08:00:00Z')

      await insertNote(user, 'tag', randomUUID(), 'Later note', laterStart)
      await insertNote(user, 'tag', randomUUID(), 'Earlier note', earlierStart)

      const results = await getNotesForTimeRange(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(results).toHaveLength(2)
      expect(results[0].content).toBe('Earlier note')
      expect(results[1].content).toBe('Later note')
    })
  })

  describe('getNotesByEntityIds', () => {
    test('returns empty map for empty IDs array', async () => {
      const user = getTestUser()
      const result = await getNotesByEntityIds(user, 'activity', [])
      expect(result.size).toBe(0)
    })

    test('returns notes grouped by entity ID', async () => {
      const user = getTestUser()
      const entityId1 = randomUUID()
      const entityId2 = randomUUID()

      await insertNote(user, 'activity', entityId1, 'Note 1a')
      await insertNote(user, 'activity', entityId1, 'Note 1b')
      await insertNote(user, 'activity', entityId2, 'Note 2a')

      const result = await getNotesByEntityIds(user, 'activity', [entityId1, entityId2])

      expect(result.size).toBe(2)
      expect(result.get(entityId1)).toHaveLength(2)
      expect(result.get(entityId1)![0].content).toBe('Note 1a')
      expect(result.get(entityId1)![1].content).toBe('Note 1b')
      expect(result.get(entityId2)).toHaveLength(1)
      expect(result.get(entityId2)![0].content).toBe('Note 2a')
    })

    test('only returns notes for the requested entity type', async () => {
      const user = getTestUser()
      const entityId = randomUUID()

      await insertNote(user, 'activity', entityId, 'Activity note')
      await insertNote(user, 'tag', entityId, 'Tag note')

      const result = await getNotesByEntityIds(user, 'activity', [entityId])

      expect(result.size).toBe(1)
      expect(result.get(entityId)).toHaveLength(1)
      expect(result.get(entityId)![0].content).toBe('Activity note')
    })

    test('entities without notes are absent from the map', async () => {
      const user = getTestUser()
      const entityId1 = randomUUID()
      const entityId2 = randomUUID()

      await insertNote(user, 'activity', entityId1, 'Only entity 1 has a note')

      const result = await getNotesByEntityIds(user, 'activity', [entityId1, entityId2])

      expect(result.size).toBe(1)
      expect(result.has(entityId1)).toBe(true)
      expect(result.has(entityId2)).toBe(false)
    })
  })

  describe('metric entity type with composite key', () => {
    test('creates and retrieves a note with composite metric entity_id', async () => {
      const user = getTestUser()
      const entityId = '2024-01-15T10:30:00.000Z|heart_rate|oura'

      const note = await insertNote(user, 'metric', entityId, 'HRV low due to illness')

      expect(note.id).toBeDefined()
      expect(note.entity_type).toBe('metric')
      expect(note.entity_id).toBe(entityId)
      expect(note.content).toBe('HRV low due to illness')
      // Metric notes have no inherited times
      expect(note.start_time).toBeUndefined()
      expect(note.end_time).toBeUndefined()
    })

    test('retrieves notes for a metric entity', async () => {
      const user = getTestUser()
      const entityId = '2024-01-15T10:30:00.000Z|weight|manual'

      await insertNote(user, 'metric', entityId, 'Weight high after big meal')
      await insertNote(user, 'metric', entityId, 'Follow-up measurement')

      const notes = await getNotesForEntity(user, 'metric', entityId)

      expect(notes).toHaveLength(2)
      expect(notes[0].content).toBe('Weight high after big meal')
      expect(notes[1].content).toBe('Follow-up measurement')
    })

    test('metric notes do not interfere with UUID-based entity notes', async () => {
      const user = getTestUser()
      const metricEntityId = '2024-01-15T10:30:00.000Z|heart_rate|oura'
      const activityEntityId = randomUUID()

      await insertNote(user, 'metric', metricEntityId, 'Metric note')
      await insertNote(user, 'activity', activityEntityId, 'Activity note')

      const metricNotes = await getNotesForEntity(user, 'metric', metricEntityId)
      const activityNotes = await getNotesForEntity(user, 'activity', activityEntityId)

      expect(metricNotes).toHaveLength(1)
      expect(metricNotes[0].content).toBe('Metric note')
      expect(activityNotes).toHaveLength(1)
      expect(activityNotes[0].content).toBe('Activity note')
    })

    test('getNotesByEntityIds works with composite metric entity_ids', async () => {
      const user = getTestUser()
      const entityId1 = '2024-01-15T10:30:00.000Z|heart_rate|oura'
      const entityId2 = '2024-01-16T08:00:00.000Z|weight|manual'

      await insertNote(user, 'metric', entityId1, 'HR note')
      await insertNote(user, 'metric', entityId2, 'Weight note')

      const result = await getNotesByEntityIds(user, 'metric', [entityId1, entityId2])

      expect(result.size).toBe(2)
      expect(result.get(entityId1)).toHaveLength(1)
      expect(result.get(entityId1)![0].content).toBe('HR note')
      expect(result.get(entityId2)).toHaveLength(1)
      expect(result.get(entityId2)![0].content).toBe('Weight note')
    })
  })

  describe('deleteNote', () => {
    test('deletes note and returns true', async () => {
      const user = getTestUser()
      const entityId = randomUUID()

      const created = await insertNote(user, 'activity', entityId, 'To be deleted')
      const result = await deleteNote(user, created.id)

      expect(result).toBe(true)

      const found = await getNoteById(user, created.id)
      expect(found).toBeNull()
    })

    test('returns false for non-existent note', async () => {
      const user = getTestUser()
      const result = await deleteNote(user, randomUUID())
      expect(result).toBe(false)
    })
  })
})
