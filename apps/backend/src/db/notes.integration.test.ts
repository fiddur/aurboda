import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  deleteNote,
  getNoteById,
  getNoteRoot,
  getNotesByEntityIds,
  getNotesForEntity,
  getNotesForTimeRange,
  getRepliesForRootIds,
  getUserNotesJoined,
  insertNote,
  replaceUserNotes,
  updateNoteFields,
  updateNoteTimesForEntity,
  upsertSyncedNote,
} from './notes.ts'

const CONTAINER_TIMEOUT = 120_000

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

      const note = await insertNote(user, 'activity', entityId, 'Morning run', startTime, endTime)

      expect(note.start_time).toEqual(startTime)
      expect(note.end_time).toEqual(endTime)
    })

    test('creates a note with only start_time (point-in-time)', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const startTime = new Date('2024-01-15T09:00:00Z')

      const note = await insertNote(user, 'activity', entityId, 'Point in time note', startTime)

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

      const created = await insertNote(user, 'activity', entityId, 'A note on a tag')
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

  describe('updateNoteFields', () => {
    test('updates note content and updated_at', async () => {
      const user = getTestUser()
      const entityId = randomUUID()

      const created = await insertNote(user, 'activity', entityId, 'Original content')
      const updated = await updateNoteFields(user, created.id, { content: 'Updated content' })

      expect(updated).not.toBeNull()
      expect(updated!.content).toBe('Updated content')
      expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(created.updated_at.getTime())
    })

    test('changes content alone without touching the times', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T09:00:00Z')
      const end = new Date('2024-01-15T10:00:00Z')

      const created = await insertNote(user, 'time', null, 'Original', start, end)
      const updated = await updateNoteFields(user, created.id, { content: 'Reworded' })

      expect(updated!.content).toBe('Reworded')
      expect(updated!.start_time).toEqual(start)
      expect(updated!.end_time).toEqual(end)
    })

    test('clears the end when end_time is null, turning a span into a point', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T09:00:00Z')
      const end = new Date('2024-01-15T10:00:00Z')

      const created = await insertNote(user, 'time', null, 'Spanning', start, end)
      const updated = await updateNoteFields(user, created.id, { end_time: null })

      expect(updated!.start_time).toEqual(start)
      expect(updated!.end_time).toBeUndefined()
    })

    test('moves a note in time without touching the content', async () => {
      const user = getTestUser()
      const created = await insertNote(user, 'time', null, 'Moment', new Date('2024-01-15T09:00:00Z'))

      const newStart = new Date('2024-01-15T11:30:00Z')
      const newEnd = new Date('2024-01-15T12:00:00Z')
      const updated = await updateNoteFields(user, created.id, { end_time: newEnd, start_time: newStart })

      expect(updated!.content).toBe('Moment')
      expect(updated!.start_time).toEqual(newStart)
      expect(updated!.end_time).toEqual(newEnd)
    })

    test('returns null for non-existent note', async () => {
      const user = getTestUser()
      const updated = await updateNoteFields(user, randomUUID(), { content: 'New content' })
      expect(updated).toBeNull()
    })
  })

  describe('updateNoteTimesForEntity', () => {
    test('updates start_time and end_time on all notes for an entity', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const initialStart = new Date('2024-01-15T08:00:00Z')
      const initialEnd = new Date('2024-01-15T08:30:00Z')

      const note1 = await insertNote(user, 'activity', entityId, 'First note', initialStart, initialEnd)
      const note2 = await insertNote(user, 'activity', entityId, 'Second note', initialStart, initialEnd)

      const newStart = new Date('2024-01-15T08:15:00Z')
      const newEnd = new Date('2024-01-15T09:00:00Z')
      await updateNoteTimesForEntity(user, 'activity', entityId, newStart, newEnd)

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

      const note = await insertNote(user, 'activity', entityId, 'Has end time', start, end)
      expect(note.end_time).toBeDefined()

      await updateNoteTimesForEntity(user, 'activity', entityId, start, undefined)

      const updated = await getNoteById(user, note.id)
      expect(updated!.start_time).toEqual(start)
      expect(updated!.end_time).toBeUndefined()
    })

    test('does not affect notes on other entities', async () => {
      const user = getTestUser()
      const entityId1 = randomUUID()
      const entityId2 = randomUUID()
      const start = new Date('2024-01-15T08:00:00Z')

      const note1 = await insertNote(user, 'activity', entityId1, 'Entity 1 note', start)
      const note2 = await insertNote(user, 'activity', entityId2, 'Entity 2 note', start)

      const newStart = new Date('2024-01-15T10:00:00Z')
      await updateNoteTimesForEntity(user, 'activity', entityId1, newStart)

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

      await insertNote(user, 'activity', entityId, 'In range', start, end)

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

      await insertNote(user, 'activity', entityId, 'Long tag note', monthStart, monthEnd)

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
        'activity',
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

      await insertNote(user, 'activity', entityId, 'Point-in-time note', pointInTime)

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

      await insertNote(user, 'activity', entityId, 'Outside', outsideTime)

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

      await insertNote(user, 'activity', randomUUID(), 'Later note', laterStart)
      await insertNote(user, 'activity', randomUUID(), 'Earlier note', earlierStart)

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
      await insertNote(user, 'metric', entityId, 'Metric note')

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

  describe('time-anchored notes', () => {
    test('stores a note anchored to a moment with a null entity_id', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T12:00:00Z')
      const end = new Date('2024-01-15T12:30:00Z')

      const note = await insertNote(user, 'time', null, 'Headache came on', start, end)

      expect(note.entity_id).toBeNull()
      expect(note.entity_type).toBe('time')
      expect(note.start_time).toEqual(start)
      expect(note.end_time).toEqual(end)

      const found = await getNoteById(user, note.id)
      expect(found!.entity_id).toBeNull()
    })

    test('the CHECK constraint rejects a time note carrying an entity_id', async () => {
      const user = getTestUser()
      await expect(
        insertNote(user, 'time', randomUUID(), 'Bad shape', new Date('2024-01-15T12:00:00Z')),
      ).rejects.toThrow(/notes_shape_check/)
    })

    test('the CHECK constraint rejects a time note with no start_time', async () => {
      const user = getTestUser()
      await expect(insertNote(user, 'time', null, 'No anchor')).rejects.toThrow(/notes_shape_check/)
    })

    test('the CHECK constraint rejects an anchored note with no entity_id', async () => {
      const user = getTestUser()
      await expect(insertNote(user, 'activity', null, 'Dangling')).rejects.toThrow(/notes_shape_check/)
    })
  })

  describe('replies', () => {
    test('getRepliesForRootIds groups replies by root, oldest first', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T12:00:00Z')
      const rootA = await insertNote(user, 'time', null, 'Root A', start)
      const rootB = await insertNote(user, 'time', null, 'Root B', start)

      await insertNote(user, 'note', rootA.id, 'A first', start)
      await insertNote(user, 'note', rootA.id, 'A second', start)
      await insertNote(user, 'note', rootB.id, 'B only', start)

      const replies = await getRepliesForRootIds(user, [rootA.id, rootB.id])

      expect(replies.get(rootA.id)!.map((r) => r.content)).toEqual(['A first', 'A second'])
      expect(replies.get(rootB.id)!.map((r) => r.content)).toEqual(['B only'])
    })

    test('getNoteRoot resolves a reply to its root and a root to itself', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T12:00:00Z')
      const root = await insertNote(user, 'time', null, 'Root', start)
      const reply = await insertNote(user, 'note', root.id, 'Reply', start)

      expect((await getNoteRoot(user, reply.id))!.id).toBe(root.id)
      expect((await getNoteRoot(user, root.id))!.id).toBe(root.id)
      expect(await getNoteRoot(user, randomUUID())).toBeNull()
    })

    test('getNotesForTimeRange returns roots only — a reply never appears', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T12:00:00Z')
      const root = await insertNote(user, 'time', null, 'Root', start)
      await insertNote(user, 'note', root.id, 'Reply', start)

      const results = await getNotesForTimeRange(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(results.map((n) => n.content)).toEqual(['Root'])
    })

    test('updateNoteTimesForEntity moves a root and its replies together', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const start = new Date('2024-01-15T08:00:00Z')

      const root = await insertNote(user, 'activity', entityId, 'Root', start)
      const reply = await insertNote(user, 'note', root.id, 'Reply', start)

      const newStart = new Date('2024-01-15T10:00:00Z')
      const newEnd = new Date('2024-01-15T11:00:00Z')
      await updateNoteTimesForEntity(user, 'activity', entityId, newStart, newEnd)

      expect((await getNoteById(user, root.id))!.start_time).toEqual(newStart)
      expect((await getNoteById(user, reply.id))!.start_time).toEqual(newStart)
      expect((await getNoteById(user, reply.id))!.end_time).toEqual(newEnd)
    })

    test('getUserNotesJoined never includes a reply', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const start = new Date('2024-01-15T08:00:00Z')

      const root = await insertNote(user, 'activity', entityId, 'Visible note', start)
      await insertNote(user, 'note', root.id, 'Thread chatter', start)

      const joined = await getUserNotesJoined(user, 'activity', entityId)

      expect(joined).toBe('Visible note')
    })
  })

  describe('replaceUserNotes', () => {
    test('removes the replies of the user notes it wipes', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const start = new Date('2024-01-15T08:00:00Z')

      const root = await insertNote(user, 'activity', entityId, 'Old note', start)
      const reply = await insertNote(user, 'note', root.id, 'Reply to old', start)

      await replaceUserNotes(user, 'activity', entityId, 'New note', start)

      expect(await getNoteById(user, root.id)).toBeNull()
      expect(await getNoteById(user, reply.id)).toBeNull()

      const remaining = await getNotesForEntity(user, 'activity', entityId)
      expect(remaining.map((n) => n.content)).toEqual(['New note'])
    })

    test('leaves a synced note and its replies alone', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const start = new Date('2024-01-15T08:00:00Z')

      await upsertSyncedNote(user, 'activity', entityId, 'health_connect', 'Synced note', start)
      const synced = (await getNotesForEntity(user, 'activity', entityId))[0]
      const syncedReply = await insertNote(user, 'note', synced.id, 'Reply to synced', start)
      const userRoot = await insertNote(user, 'activity', entityId, 'User note', start)
      const userReply = await insertNote(user, 'note', userRoot.id, 'Reply to user note', start)

      await replaceUserNotes(user, 'activity', entityId, 'Replacement', start)

      expect(await getNoteById(user, synced.id)).not.toBeNull()
      expect(await getNoteById(user, syncedReply.id)).not.toBeNull()
      expect(await getNoteById(user, userRoot.id)).toBeNull()
      expect(await getNoteById(user, userReply.id)).toBeNull()
    })
  })

  describe('deleteNote', () => {
    test('deleting a root removes its replies too', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T12:00:00Z')
      const root = await insertNote(user, 'time', null, 'Root', start)
      const reply = await insertNote(user, 'note', root.id, 'Reply', start)
      const otherRoot = await insertNote(user, 'time', null, 'Untouched', start)

      expect(await deleteNote(user, root.id)).toBe(true)

      expect(await getNoteById(user, root.id)).toBeNull()
      expect(await getNoteById(user, reply.id)).toBeNull()
      expect(await getNoteById(user, otherRoot.id)).not.toBeNull()
    })

    test('deleting a reply removes only itself', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T12:00:00Z')
      const root = await insertNote(user, 'time', null, 'Root', start)
      const reply1 = await insertNote(user, 'note', root.id, 'Reply 1', start)
      const reply2 = await insertNote(user, 'note', root.id, 'Reply 2', start)

      expect(await deleteNote(user, reply1.id)).toBe(true)

      expect(await getNoteById(user, reply1.id)).toBeNull()
      expect(await getNoteById(user, reply2.id)).not.toBeNull()
      expect(await getNoteById(user, root.id)).not.toBeNull()
    })

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
