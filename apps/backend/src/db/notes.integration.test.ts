import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { deleteActivity, insertActivity, restoreActivity } from './activities/index.ts'
import { query, withUserTransaction } from './connection.ts'
import { insertMeal } from './meals.ts'
import {
  deleteNote,
  deleteNotesForEntitiesIn,
  deleteNotesForEntityIn,
  getDeletedNotes,
  getNoteById,
  getNoteNeighbors,
  getNoteRevisions,
  getNoteRoot,
  getNotesByEntityIds,
  getNotesForEntity,
  getNotesForTimeRange,
  getNotesWithAnyTag,
  getRepliesForRootIds,
  getUserNotesJoined,
  insertNote,
  listNoteTags,
  type NoteFieldUpdates,
  type NotesSearchParams,
  pruneDeletedNotes,
  replaceUserNotes,
  restoreNote,
  searchNotes,
  softDeleteNote,
  updateNoteGuarded,
  updateNoteTimesForEntity,
  upsertSyncedNote,
} from './notes.ts'
import { deleteProductivityRecord, insertProductivity, restoreProductivityRecord } from './productivity.ts'
import { insertReport } from './reports.ts'

const CONTAINER_TIMEOUT = 120_000

const DAY = { end: new Date('2024-01-15T23:59:59Z'), start: new Date('2024-01-15T00:00:00Z') }

const contentInDay = async (user: string): Promise<string[]> =>
  (await getNotesForTimeRange(user, DAY.start, DAY.end)).map((n) => n.content)

const REVISIONS = { limit: 50, min_interval_minutes: 10 }

const updateNoteFields = async (user: string, id: string, fields: NoteFieldUpdates) => {
  const result = await updateNoteGuarded(user, id, fields, { revisions: REVISIONS })
  return result.status === 'updated' ? result.note : null
}

const search = (user: string, params: Partial<NotesSearchParams> = {}) =>
  searchNotes(user, { entity_types: ['time', 'day'], limit: 50, tz: 'UTC', ...params })

const neighbors = async (user: string, id: string, tz = 'UTC') => {
  const found = await getNoteNeighbors(user, id, { entity_types: ['time', 'day'], tz })
  return found && { next: found.next?.content ?? null, previous: found.previous?.content ?? null }
}

const setCreatedAt = (user: string, id: string, createdAt: string) =>
  query(user, `UPDATE notes SET created_at = $2::timestamptz WHERE id = $1`, [id, createdAt])

const ageDeletion = (user: string, id: string, days: number) =>
  query(user, `UPDATE notes SET deleted_at = NOW() - make_interval(days => $2::int) WHERE id = $1`, [
    id,
    days,
  ])

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

  describe('updateNoteGuarded', () => {
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
      const start = new Date('2024-01-15T08:15:00Z')
      const end = new Date('2024-01-15T08:45:00Z')

      await insertNote(user, 'time', null, 'In range', start, end)

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
      // Long-spanning tag (e.g. a month)
      const monthStart = new Date('2024-01-01T00:00:00Z')
      const monthEnd = new Date('2024-01-31T23:59:59Z')

      await insertNote(user, 'time', null, 'Long tag note', monthStart, monthEnd)

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
      // Note is the day before
      await insertNote(
        user,
        'time',
        null,
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
      const pointInTime = new Date('2024-01-15T12:00:00Z')

      await insertNote(user, 'time', null, 'Point-in-time note', pointInTime)

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
      const outsideTime = new Date('2024-01-16T12:00:00Z')

      await insertNote(user, 'time', null, 'Outside', outsideTime)

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

      await insertNote(user, 'time', null, 'Later note', laterStart)
      await insertNote(user, 'time', null, 'Earlier note', earlierStart)

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

  describe('getNotesForTimeRange — parents', () => {
    const at = new Date('2024-01-15T10:00:00Z')

    test('hides a comment while its activity is soft-deleted, and shows it again on restore', async () => {
      const user = getTestUser()
      const activityId = await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        source: 'manual',
        start_time: at,
      })
      await insertNote(user, 'activity', activityId, 'On the run', at)

      expect(await contentInDay(user)).toEqual(['On the run'])

      await deleteActivity(user, activityId)
      expect(await contentInDay(user)).toEqual([])

      await restoreActivity(user, activityId)
      expect(await contentInDay(user)).toEqual(['On the run'])
    })

    test('hides a comment while its productivity record is soft-deleted, and shows it again on restore', async () => {
      const user = getTestUser()
      await insertProductivity(user, [
        {
          activity: 'editor',
          category: 'Software Development',
          duration_sec: 600,
          end_time: new Date('2024-01-15T10:10:00Z'),
          productivity: 2,
          source: 'rescuetime',
          start_time: at,
        },
      ])
      const { rows } = await query<{ id: string }>(user, `SELECT id FROM productivity`)
      const recordId = rows[0].id
      await insertNote(user, 'productivity', recordId, 'Deep work', at)

      expect(await contentInDay(user)).toEqual(['Deep work'])

      await deleteProductivityRecord(user, recordId)
      expect(await contentInDay(user)).toEqual([])

      await restoreProductivityRecord(user, recordId)
      expect(await contentInDay(user)).toEqual(['Deep work'])
    })

    test('keeps comments on a meal and a report that exist', async () => {
      const user = getTestUser()
      const meal = await insertMeal(user, { name: 'Lunch', time: at })
      const report = await insertReport(user, { entries: [], report_date: at, report_type: 'inbody' })
      await insertNote(user, 'meal', meal.id, 'Salty', at)
      await insertNote(user, 'report', report.id, 'Odd value', at)

      expect((await contentInDay(user)).sort()).toEqual(['Odd value', 'Salty'])
    })

    test('hides a comment whose parent does not exist at all', async () => {
      const user = getTestUser()
      await insertNote(user, 'activity', randomUUID(), 'Lost activity', at)
      await insertNote(user, 'productivity', randomUUID(), 'Lost record', at)
      await insertNote(user, 'meal', randomUUID(), 'Lost meal', at)
      await insertNote(user, 'report', randomUUID(), 'Lost report', at)
      await insertNote(user, 'meal', 'not-a-uuid', 'Malformed id', at)
      await insertNote(user, 'time', null, 'A moment', at)

      expect(await contentInDay(user)).toEqual(['A moment'])
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

  describe('upsertSyncedNote', () => {
    test("clearing (content undefined) removes only that source's note on the entity", async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const start = new Date('2024-01-15T08:00:00Z')

      await upsertSyncedNote(user, 'activity', entityId, 'gravl', 'Bench 3x5', start)
      await upsertSyncedNote(user, 'activity', entityId, 'health_connect', 'HC note', start)
      await insertNote(user, 'activity', entityId, 'User comment', start)

      await upsertSyncedNote(user, 'activity', entityId, 'gravl', undefined)

      const remaining = await getNotesForEntity(user, 'activity', entityId)
      expect(remaining.map((n) => n.content).sort()).toEqual(['HC note', 'User comment'])
    })

    test('clearing removes the replies of the synced note too', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const start = new Date('2024-01-15T08:00:00Z')

      await upsertSyncedNote(user, 'activity', entityId, 'oura', 'Tag comment', start)
      const [synced] = await getNotesForEntity(user, 'activity', entityId)
      const reply = await insertNote(user, 'note', synced.id, 'My reply', start)

      await upsertSyncedNote(user, 'activity', entityId, 'oura', undefined)

      expect(await getNoteById(user, synced.id)).toBeNull()
      expect(await getNoteById(user, reply.id)).toBeNull()
    })

    test('moving the synced note in time moves its replies with it', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const start = new Date('2024-01-15T08:00:00Z')
      const movedStart = new Date('2024-01-15T09:00:00Z')
      const movedEnd = new Date('2024-01-15T09:30:00Z')

      await upsertSyncedNote(user, 'activity', entityId, 'oura', 'Tag comment', start)
      const [synced] = await getNotesForEntity(user, 'activity', entityId)
      const reply = await insertNote(user, 'note', synced.id, 'My reply', start)

      await upsertSyncedNote(user, 'activity', entityId, 'oura', 'Tag comment', movedStart, movedEnd)

      const movedReply = await getNoteById(user, reply.id)
      expect(movedReply!.start_time).toEqual(movedStart)
      expect(movedReply!.end_time).toEqual(movedEnd)
      expect(movedReply!.content).toBe('My reply')
    })
  })

  describe('deleteNotesForEntityIn', () => {
    test('removes every comment on the entity and their replies', async () => {
      const user = getTestUser()
      const mealId = randomUUID()
      const otherMealId = randomUUID()
      const start = new Date('2024-01-15T12:00:00Z')

      const root1 = await insertNote(user, 'meal', mealId, 'Too salty', start)
      const root2 = await insertNote(user, 'meal', mealId, 'Second thought', start)
      const reply = await insertNote(user, 'note', root1.id, 'Still too salty', start)
      const otherRoot = await insertNote(user, 'meal', otherMealId, 'Different meal', start)
      const otherReply = await insertNote(user, 'note', otherRoot.id, 'Untouched', start)

      expect(await withUserTransaction(user, (tx) => deleteNotesForEntityIn(tx, 'meal', mealId))).toBe(2)

      expect(await getNoteById(user, root1.id)).toBeNull()
      expect(await getNoteById(user, root2.id)).toBeNull()
      expect(await getNoteById(user, reply.id)).toBeNull()
      expect(await getNoteById(user, otherRoot.id)).not.toBeNull()
      expect(await getNoteById(user, otherReply.id)).not.toBeNull()
    })

    test('returns 0 when the entity has no comments', async () => {
      const user = getTestUser()

      expect(await withUserTransaction(user, (tx) => deleteNotesForEntityIn(tx, 'meal', randomUUID()))).toBe(
        0,
      )
    })
  })

  describe('deleteNotesForEntitiesIn', () => {
    test('removes every comment on the given entities and their replies', async () => {
      const user = getTestUser()
      const firstId = randomUUID()
      const secondId = randomUUID()
      const otherId = randomUUID()
      const start = new Date('2024-01-15T12:00:00Z')

      const first = await insertNote(user, 'activity', firstId, 'First', start)
      const second = await insertNote(user, 'activity', secondId, 'Second', start)
      const reply = await insertNote(user, 'note', first.id, 'Reply', start)
      const other = await insertNote(user, 'activity', otherId, 'Other', start)

      expect(
        await withUserTransaction(user, (tx) =>
          deleteNotesForEntitiesIn(tx, 'activity', [firstId, secondId]),
        ),
      ).toBe(2)

      expect(await getNoteById(user, first.id)).toBeNull()
      expect(await getNoteById(user, second.id)).toBeNull()
      expect(await getNoteById(user, reply.id)).toBeNull()
      expect(await getNoteById(user, other.id)).not.toBeNull()
    })

    test('returns 0 for no entity ids', async () => {
      const user = getTestUser()

      expect(await withUserTransaction(user, (tx) => deleteNotesForEntitiesIn(tx, 'activity', []))).toBe(0)
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
  describe('journal fields', () => {
    test('a day note keeps its date as a calendar date, with no times', async () => {
      const user = getTestUser()
      const note = await insertNote(user, 'day', null, '', undefined, undefined, {
        date: '2024-02-29',
        hashtags: ['travel'],
        tags: ['family'],
        title: 'Leap day',
      })

      const found = await getNoteById(user, note.id)
      expect(found).toMatchObject({
        content: '',
        date: '2024-02-29',
        entity_id: null,
        entity_type: 'day',
        hashtags: ['travel'],
        tags: ['family'],
        title: 'Leap day',
      })
      expect(found!.start_time).toBeUndefined()
    })

    test('the shape check refuses a day note with times or without a date', async () => {
      const user = getTestUser()
      await expect(insertNote(user, 'day', null, 'x', new Date('2024-01-15T09:00:00Z'))).rejects.toThrow()
      await expect(insertNote(user, 'day', null, 'x')).rejects.toThrow()
      await expect(
        insertNote(user, 'time', null, 'x', new Date('2024-01-15T09:00:00Z'), undefined, {
          date: '2024-01-15',
        }),
      ).rejects.toThrow()
    })
  })

  describe('updateNoteGuarded — conflicts, revisions and kinds', () => {
    test('a stale expected_updated_at writes nothing and answers the current note', async () => {
      const user = getTestUser()
      const created = await insertNote(user, 'time', null, 'First', new Date('2024-01-15T09:00:00Z'))
      await updateNoteFields(user, created.id, { content: 'Changed elsewhere' })

      const result = await updateNoteGuarded(
        user,
        created.id,
        { content: 'Mine' },
        { expected_updated_at: created.updated_at, revisions: REVISIONS },
      )

      expect(result.status).toBe('conflict')
      expect(result.status === 'conflict' && result.note.content).toBe('Changed elsewhere')
      expect((await getNoteById(user, created.id))!.content).toBe('Changed elsewhere')
    })

    test('a matching expected_updated_at writes', async () => {
      const user = getTestUser()
      const created = await insertNote(user, 'time', null, 'First', new Date('2024-01-15T09:00:00Z'))

      const result = await updateNoteGuarded(
        user,
        created.id,
        { content: 'Second' },
        { expected_updated_at: created.updated_at, revisions: REVISIONS },
      )

      expect(result.status).toBe('updated')
      expect((await getNoteById(user, created.id))!.content).toBe('Second')
    })

    test('a move worked out for a time entry that became a day entry meanwhile is a conflict', async () => {
      const user = getTestUser()
      const created = await insertNote(user, 'time', null, 'Moving', new Date('2024-01-15T09:00:00Z'))
      await updateNoteGuarded(
        user,
        created.id,
        { date: '2024-01-15', end_time: null, entity_type: 'day', start_time: null },
        { revisions: REVISIONS },
      )

      const result = await updateNoteGuarded(
        user,
        created.id,
        { start_time: new Date('2024-01-15T10:00:00Z') },
        { expected_entity_type: 'time', revisions: REVISIONS },
      )

      expect(result.status).toBe('conflict')
      expect(result.status === 'conflict' && result.note.entity_type).toBe('day')
      const stored = (await getNoteById(user, created.id))!
      expect(stored.entity_type).toBe('day')
      expect(stored.date).toBe('2024-01-15')
    })

    test('concurrent kind switch and move: one applies, the other conflicts, never a shape error', async () => {
      const user = getTestUser()
      const created = await insertNote(user, 'time', null, 'Race', new Date('2024-01-15T09:00:00Z'))

      const results = await Promise.all([
        updateNoteGuarded(
          user,
          created.id,
          { date: '2024-01-15', end_time: null, entity_type: 'day', start_time: null },
          { expected_entity_type: 'time', revisions: REVISIONS },
        ),
        updateNoteGuarded(
          user,
          created.id,
          { start_time: new Date('2024-01-15T11:00:00Z') },
          { expected_entity_type: 'time', revisions: REVISIONS },
        ),
      ])

      expect(results.map((r) => r.status)).toContain('updated')
    })

    test('a soft-deleted note is not found', async () => {
      const user = getTestUser()
      const created = await insertNote(user, 'time', null, 'Gone', new Date('2024-01-15T09:00:00Z'))
      await softDeleteNote(user, created.id)

      const result = await updateNoteGuarded(user, created.id, { content: 'x' }, { revisions: REVISIONS })
      expect(result.status).toBe('not_found')
    })

    test('keeps the replaced text as a revision, once per burst of saves', async () => {
      const user = getTestUser()
      const created = await insertNote(
        user,
        'time',
        null,
        'v1',
        new Date('2024-01-15T09:00:00Z'),
        undefined,
        {
          title: 'T1',
        },
      )

      await updateNoteFields(user, created.id, { content: 'v2' })
      await updateNoteFields(user, created.id, { content: 'v3' })
      await updateNoteFields(user, created.id, { tags: ['x'] })

      const revisions = await getNoteRevisions(user, created.id)
      expect(revisions.map((r) => [r.content, r.title])).toEqual([['v1', 'T1']])
    })

    test('a change after the interval keeps another revision, newest first', async () => {
      const user = getTestUser()
      const created = await insertNote(user, 'time', null, 'v1', new Date('2024-01-15T09:00:00Z'))
      await updateNoteFields(user, created.id, { content: 'v2' })
      await query(user, `UPDATE note_revisions SET saved_at = NOW() - interval '11 minutes'`)
      await updateNoteFields(user, created.id, { title: 'Titled' })

      const revisions = await getNoteRevisions(user, created.id)
      expect(revisions.map((r) => r.content)).toEqual(['v2', 'v1'])
    })

    test('the first save of an entry created empty keeps no empty revision', async () => {
      const user = getTestUser()
      const created = await insertNote(user, 'time', null, '', new Date('2024-01-15T09:00:00Z'))
      await updateNoteFields(user, created.id, { content: 'First words', title: 'A day' })
      expect(await getNoteRevisions(user, created.id)).toEqual([])

      await updateNoteFields(user, created.id, { content: 'Second words' })
      const revisions = await getNoteRevisions(user, created.id)
      expect(revisions.map((r) => [r.content, r.title])).toEqual([['First words', 'A day']])
    })

    test('an unchanged content keeps no revision', async () => {
      const user = getTestUser()
      const created = await insertNote(user, 'time', null, 'Same', new Date('2024-01-15T09:00:00Z'))
      await updateNoteFields(user, created.id, { content: 'Same' })
      expect(await getNoteRevisions(user, created.id)).toEqual([])
    })

    test('keeps only the newest revisions up to the limit', async () => {
      const user = getTestUser()
      const created = await insertNote(user, 'time', null, 'v0', new Date('2024-01-15T09:00:00Z'))
      for (let i = 1; i <= 5; i++) {
        await updateNoteGuarded(
          user,
          created.id,
          { content: `v${i}` },
          { revisions: { limit: 3, min_interval_minutes: 0 } },
        )
      }
      const revisions = await getNoteRevisions(user, created.id)
      expect(revisions.map((r) => r.content)).toEqual(['v4', 'v3', 'v2'])
    })

    test('revisions go with the note when it is removed for good', async () => {
      const user = getTestUser()
      const created = await insertNote(user, 'time', null, 'v1', new Date('2024-01-15T09:00:00Z'))
      await updateNoteFields(user, created.id, { content: 'v2' })
      await deleteNote(user, created.id)
      const left = await query(user, `SELECT 1 FROM note_revisions`)
      expect(left.rows).toHaveLength(0)
    })

    test('a time note given a date becomes a day note, and its replies follow', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T09:00:00Z')
      const root = await insertNote(user, 'time', null, 'Root', start)
      const reply = await insertNote(user, 'note', root.id, 'Reply', start)

      const updated = await updateNoteFields(user, root.id, {
        date: '2024-01-20',
        end_time: null,
        entity_type: 'day',
        start_time: null,
      })

      expect(updated).toMatchObject({ date: '2024-01-20', entity_type: 'day' })
      expect(updated!.start_time).toBeUndefined()
      const movedReply = await getNoteById(user, reply.id)
      expect(movedReply!.date).toBe('2024-01-20')
      expect(movedReply!.start_time).toBeUndefined()
    })

    test('a day note given a start_time becomes a time note, and its replies follow', async () => {
      const user = getTestUser()
      const root = await insertNote(user, 'day', null, 'Root', undefined, undefined, { date: '2024-01-20' })
      const reply = await insertNote(user, 'note', root.id, 'Reply', undefined, undefined, {
        date: '2024-01-20',
      })
      const start = new Date('2024-01-20T08:00:00Z')

      const updated = await updateNoteFields(user, root.id, {
        date: null,
        end_time: null,
        entity_type: 'time',
        start_time: start,
      })

      expect(updated).toMatchObject({ entity_type: 'time', start_time: start })
      expect(updated!.date).toBeUndefined()
      const movedReply = await getNoteById(user, reply.id)
      expect(movedReply!.start_time).toEqual(start)
      expect(movedReply!.date).toBeUndefined()
    })
  })

  describe('soft deletion', () => {
    test('deleting a root hides it and its live replies from every reader', async () => {
      const user = getTestUser()
      const activityId = await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        source: 'manual',
        start_time: new Date('2024-01-15T10:00:00Z'),
      })
      const root = await insertNote(
        user,
        'activity',
        activityId,
        'Root',
        new Date('2024-01-15T10:00:00Z'),
        new Date('2024-01-15T11:00:00Z'),
      )
      const reply = await insertNote(user, 'note', root.id, 'Reply', new Date('2024-01-15T10:00:00Z'))

      expect(await softDeleteNote(user, root.id)).toBe(true)

      expect(await getNoteById(user, root.id)).toBeNull()
      expect(await getNoteById(user, reply.id)).toBeNull()
      expect(await getNoteRoot(user, reply.id)).toBeNull()
      expect(await getNotesForEntity(user, 'activity', activityId)).toEqual([])
      expect((await getNotesByEntityIds(user, 'activity', [activityId])).size).toBe(0)
      expect((await getRepliesForRootIds(user, [root.id])).size).toBe(0)
      expect(await getUserNotesJoined(user, 'activity', activityId)).toBeUndefined()
      expect(await contentInDay(user)).toEqual([])
      expect((await search(user, { entity_types: ['activity'] })).notes).toEqual([])
      expect((await getNoteById(user, root.id, { include_deleted: true }))!.deleted_at).toBeInstanceOf(Date)
    })

    test('a deleted note cannot be deleted again', async () => {
      const user = getTestUser()
      const note = await insertNote(user, 'time', null, 'x', new Date('2024-01-15T09:00:00Z'))
      expect(await softDeleteNote(user, note.id)).toBe(true)
      expect(await softDeleteNote(user, note.id)).toBe(false)
      expect(await softDeleteNote(user, randomUUID())).toBe(false)
    })

    test('restoring a root brings back the replies deleted with it, not one deleted before', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T12:00:00Z')
      const root = await insertNote(user, 'time', null, 'Root', start)
      const earlier = await insertNote(user, 'note', root.id, 'Deleted on its own', start)
      const later = await insertNote(user, 'note', root.id, 'Deleted with the root', start)
      await softDeleteNote(user, earlier.id)
      await ageDeletion(user, earlier.id, 1)
      await softDeleteNote(user, root.id)

      const result = await restoreNote(user, root.id)

      expect(result.status).toBe('restored')
      expect(await getNoteById(user, root.id)).not.toBeNull()
      expect(await getNoteById(user, later.id)).not.toBeNull()
      expect(await getNoteById(user, earlier.id)).toBeNull()
    })

    test('a reply under a deleted root cannot be restored until the root is', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T12:00:00Z')
      const root = await insertNote(user, 'time', null, 'Root', start)
      const reply = await insertNote(user, 'note', root.id, 'Reply', start)
      await softDeleteNote(user, root.id)

      expect((await restoreNote(user, reply.id)).status).toBe('root_deleted')
      expect(await getNoteById(user, reply.id)).toBeNull()
    })

    test('restoring a reply under a live root brings back only the reply', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T12:00:00Z')
      const root = await insertNote(user, 'time', null, 'Root', start)
      const reply = await insertNote(user, 'note', root.id, 'Reply', start)
      await softDeleteNote(user, reply.id)

      const result = await restoreNote(user, reply.id)

      expect(result.status === 'restored' && result.note.deleted_at).toBeUndefined()
      expect(await getNoteById(user, reply.id)).not.toBeNull()
    })

    test('restoring a live note answers it as it is; an unknown one is not found', async () => {
      const user = getTestUser()
      const note = await insertNote(user, 'time', null, 'Live', new Date('2024-01-15T12:00:00Z'))
      const result = await restoreNote(user, note.id)
      expect(result.status === 'restored' && result.note.content).toBe('Live')
      expect((await restoreNote(user, randomUUID())).status).toBe('not_found')
    })

    test('lists deleted roots with the replies deleted with them, and deleted replies of live roots', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T12:00:00Z')
      const liveRoot = await insertNote(user, 'time', null, 'Live root', start)
      const lonelyReply = await insertNote(user, 'note', liveRoot.id, 'Deleted reply', start)
      const deletedRoot = await insertNote(user, 'time', null, 'Deleted root', start)
      const withRoot = await insertNote(user, 'note', deletedRoot.id, 'Went with the root', start)
      await softDeleteNote(user, lonelyReply.id)
      await ageDeletion(user, lonelyReply.id, 1)
      await softDeleteNote(user, deletedRoot.id)

      const deleted = await getDeletedNotes(user)

      expect(deleted.map((d) => d.note.content)).toEqual(['Deleted root', 'Deleted reply'])
      expect(deleted[0]!.replies.map((r) => r.id)).toEqual([withRoot.id])
      expect(deleted[1]!.replies).toEqual([])
    })

    test('the system deletes still remove soft-deleted comments of a removed entity', async () => {
      const user = getTestUser()
      const entityId = randomUUID()
      const note = await insertNote(user, 'meal', entityId, 'Salty')
      await softDeleteNote(user, note.id)

      expect(await withUserTransaction(user, (tx) => deleteNotesForEntityIn(tx, 'meal', entityId))).toBe(1)
      expect(await getNoteById(user, note.id, { include_deleted: true })).toBeNull()
    })

    test('the prune removes notes deleted longer ago than the retention, with their replies', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T12:00:00Z')
      const oldRoot = await insertNote(user, 'time', null, 'Old', start)
      const oldReply = await insertNote(user, 'note', oldRoot.id, 'Old reply', start)
      const recent = await insertNote(user, 'time', null, 'Recent', start)
      const live = await insertNote(user, 'time', null, 'Live', start)
      await softDeleteNote(user, oldRoot.id)
      await query(
        user,
        `UPDATE notes SET deleted_at = NOW() - interval '31 days' WHERE deleted_at IS NOT NULL`,
      )
      await softDeleteNote(user, recent.id)

      expect(await pruneDeletedNotes(user, 30)).toBe(2)

      expect(await getNoteById(user, oldRoot.id, { include_deleted: true })).toBeNull()
      expect(await getNoteById(user, oldReply.id, { include_deleted: true })).toBeNull()
      expect(await getNoteById(user, recent.id, { include_deleted: true })).not.toBeNull()
      expect(await getNoteById(user, live.id)).not.toBeNull()
    })
  })

  describe('getNotesForTimeRange — day notes', () => {
    test('returns the day notes on the given local dates, first', async () => {
      const user = getTestUser()
      await insertNote(user, 'time', null, 'Timed', new Date('2024-01-15T09:00:00Z'))
      await insertNote(user, 'day', null, 'The day', undefined, undefined, { date: '2024-01-15' })
      await insertNote(user, 'day', null, 'Next day', undefined, undefined, { date: '2024-01-16' })
      await insertNote(user, 'day', null, 'Day before', undefined, undefined, { date: '2024-01-14' })

      const notes = await getNotesForTimeRange(user, DAY.start, DAY.end, {
        from: '2024-01-15',
        to: '2024-01-15',
      })
      expect(notes.map((n) => n.content)).toEqual(['The day', 'Timed'])
      expect(await contentInDay(user)).toEqual(['Timed'])
    })

    test('hides a deleted day note', async () => {
      const user = getTestUser()
      const note = await insertNote(user, 'day', null, 'Gone', undefined, undefined, { date: '2024-01-15' })
      await softDeleteNote(user, note.id)
      const notes = await getNotesForTimeRange(user, DAY.start, DAY.end, {
        from: '2024-01-15',
        to: '2024-01-15',
      })
      expect(notes).toEqual([])
    })
  })

  describe('searchNotes', () => {
    test('finds words in the title or the content, the last word as a prefix', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T09:00:00Z')
      await insertNote(user, 'time', null, 'Walked along the river', start)
      await insertNote(user, 'time', null, 'Nothing here', start, undefined, { title: 'Riverside café' })
      await insertNote(user, 'time', null, 'Unrelated', start)

      const exact = await search(user, { text: { websearch: 'river' } })
      expect(exact.notes.map((n) => n.content)).toEqual(['Walked along the river'])

      const prefix = await search(user, { text: { prefix: 'river', websearch: '' } })
      expect(prefix.notes.map((n) => n.content).sort()).toEqual(['Nothing here', 'Walked along the river'])
    })

    test('a text too long for one search vector is still saved, and found by its beginning', async () => {
      const user = getTestUser()
      const words = Array.from({ length: 400_000 }, (_, i) => `w${i.toString(36)}`).join(' ')
      const note = await insertNote(user, 'time', null, `opening ${words}`, new Date('2024-01-15T09:00:00Z'))

      expect(note.content.length).toBeGreaterThan(2_000_000)
      expect((await search(user, { text: { websearch: 'opening' } })).notes.map((n) => n.id)).toEqual([
        note.id,
      ])
    })

    test('a match in a reply returns its root; a deleted reply does not count', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T09:00:00Z')
      const root = await insertNote(user, 'time', null, 'Root', start)
      await insertNote(user, 'note', root.id, 'mentions pancakes', start)
      const other = await insertNote(user, 'time', null, 'Other root', start)
      const gone = await insertNote(user, 'note', other.id, 'also waffles', start)
      await softDeleteNote(user, gone.id)

      expect((await search(user, { text: { websearch: 'pancakes' } })).notes.map((n) => n.id)).toEqual([
        root.id,
      ])
      expect((await search(user, { text: { websearch: 'waffles' } })).notes).toEqual([])
    })

    test('tags must all be present, explicit or hashtag', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T09:00:00Z')
      await insertNote(user, 'time', null, 'both', start, undefined, {
        hashtags: ['family'],
        tags: ['travel'],
      })
      await insertNote(user, 'time', null, 'one', start, undefined, { tags: ['travel'] })

      const both = await search(user, { tags: ['travel', 'family'] })
      expect(both.notes.map((n) => n.content)).toEqual(['both'])
      const one = await search(user, { tags: ['travel'] })
      expect(one.notes.map((n) => n.content).sort()).toEqual(['both', 'one'])
    })

    test('from/to compare the local day in tz', async () => {
      const user = getTestUser()
      // 23:30 UTC on the 14th is already the 15th in Stockholm.
      await insertNote(user, 'time', null, 'Late', new Date('2024-01-14T23:30:00Z'))
      await insertNote(user, 'day', null, 'Day 15', undefined, undefined, { date: '2024-01-15' })
      await insertNote(user, 'day', null, 'Day 16', undefined, undefined, { date: '2024-01-16' })

      const utc = await search(user, { from: '2024-01-15', to: '2024-01-15', tz: 'UTC' })
      expect(utc.notes.map((n) => n.content)).toEqual(['Day 15'])
      const stockholm = await search(user, { from: '2024-01-15', to: '2024-01-15', tz: 'Europe/Stockholm' })
      // Newest first: the 15th starts at 23:00 UTC on the 14th in Stockholm, before 'Late'.
      expect(stockholm.notes.map((n) => n.content)).toEqual(['Late', 'Day 15'])
    })

    test('on this day: the same month and day in earlier years, with 29 February on a non-leap 28th', async () => {
      const user = getTestUser()
      await insertNote(user, 'day', null, '2024-02-29', undefined, undefined, { date: '2024-02-29' })
      await insertNote(user, 'day', null, '2023-02-28', undefined, undefined, { date: '2023-02-28' })
      await insertNote(user, 'day', null, '2025-02-28', undefined, undefined, { date: '2025-02-28' })
      await insertNote(user, 'day', null, '2024-03-01', undefined, undefined, { date: '2024-03-01' })

      const page = await search(user, { on_this_day: { before_year: 2025, month_days: ['02-28', '02-29'] } })
      expect(page.notes.map((n) => n.content)).toEqual(['2024-02-29', '2023-02-28'])

      const leap = await search(user, { on_this_day: { before_year: 2028, month_days: ['02-29'] } })
      expect(leap.notes.map((n) => n.content)).toEqual(['2024-02-29'])
    })

    test('pages newest first across day and time notes; a day note is anchored at the start of its date', async () => {
      const user = getTestUser()
      await insertNote(user, 'time', null, 'A 15th 08:00', new Date('2024-01-15T08:00:00Z'))
      await insertNote(user, 'day', null, 'B the 15th', undefined, undefined, { date: '2024-01-15' })
      await insertNote(user, 'time', null, 'C 14th 20:00', new Date('2024-01-14T20:00:00Z'))
      await insertNote(user, 'day', null, 'D the 16th', undefined, undefined, { date: '2024-01-16' })
      await insertNote(user, 'time', null, 'E 15th 08:00 again', new Date('2024-01-15T08:00:00Z'))

      const seen: string[] = []
      let cursor: NotesSearchParams['cursor']
      for (let i = 0; i < 5; i++) {
        const page = await search(user, { cursor, limit: 2 })
        seen.push(...page.notes.map((n) => n.content))
        if (!page.next_cursor) break
        cursor = page.next_cursor
      }
      expect(seen).toEqual(['D the 16th', 'E 15th 08:00 again', 'A 15th 08:00', 'B the 15th', 'C 14th 20:00'])
    })

    test('leaves out comments with no anchor and types not asked for', async () => {
      const user = getTestUser()
      await insertNote(user, 'metric', '2024-01-15T10:00:00.000Z|heart_rate|oura', 'Metric comment')
      await insertNote(user, 'time', null, 'Moment', new Date('2024-01-15T10:00:00Z'))

      expect((await search(user)).notes.map((n) => n.content)).toEqual(['Moment'])
      expect((await search(user, { entity_types: ['metric'] })).notes).toEqual([])
    })
  })

  describe('getNoteNeighbors', () => {
    test('steps through day and time entries in the Journal order, a day entry at the start of its date in tz', async () => {
      const user = getTestUser()
      const late = await insertNote(user, 'time', null, 'Late 14th', new Date('2024-01-14T23:30:00Z'))
      const day = await insertNote(user, 'day', null, 'Day 15', undefined, undefined, { date: '2024-01-15' })
      const morning = await insertNote(user, 'time', null, 'Morning 15th', new Date('2024-01-15T08:00:00Z'))

      expect(await neighbors(user, day.id)).toEqual({ next: 'Morning 15th', previous: 'Late 14th' })
      expect(await neighbors(user, late.id)).toEqual({ next: 'Day 15', previous: null })
      expect(await neighbors(user, morning.id)).toEqual({ next: null, previous: 'Day 15' })

      // The 15th starts at 23:00 UTC on the 14th in Stockholm, before 'Late 14th'.
      expect(await neighbors(user, day.id, 'Europe/Stockholm')).toEqual({ next: 'Late 14th', previous: null })
      expect(await neighbors(user, late.id, 'Europe/Stockholm')).toEqual({
        next: 'Morning 15th',
        previous: 'Day 15',
      })
    })

    test('the same anchor is ordered by created_at, then id', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T08:00:00Z')
      const first = await insertNote(user, 'time', null, 'First', start)
      const second = await insertNote(user, 'time', null, 'Second', start)
      await setCreatedAt(user, first.id, '2024-01-01T00:00:00Z')
      await setCreatedAt(user, second.id, '2024-01-02T00:00:00Z')

      expect(await neighbors(user, first.id)).toEqual({ next: 'Second', previous: null })
      expect(await neighbors(user, second.id)).toEqual({ next: null, previous: 'First' })

      await setCreatedAt(user, second.id, '2024-01-01T00:00:00Z')
      const [low, high] = [first, second].sort((a, b) => (a.id < b.id ? -1 : 1))
      expect(await neighbors(user, low.id)).toEqual({ next: high.content, previous: null })
      expect(await neighbors(user, high.id)).toEqual({ next: null, previous: low.content })
    })

    test('a single entry has no neighbours', async () => {
      const user = getTestUser()
      const only = await insertNote(user, 'time', null, 'Only', new Date('2024-01-15T08:00:00Z'))

      expect(await neighbors(user, only.id)).toEqual({ next: null, previous: null })
    })

    test('skips deleted entries and comments on entities', async () => {
      const user = getTestUser()
      const activityId = await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T09:30:00Z'),
        source: 'manual',
        start_time: new Date('2024-01-15T09:00:00Z'),
      })
      const older = await insertNote(user, 'time', null, 'Older', new Date('2024-01-15T07:00:00Z'))
      const gone = await insertNote(user, 'time', null, 'Gone', new Date('2024-01-15T08:00:00Z'))
      await insertNote(user, 'activity', activityId, 'On the run', new Date('2024-01-15T09:00:00Z'))
      const target = await insertNote(user, 'time', null, 'Target', new Date('2024-01-15T10:00:00Z'))
      await softDeleteNote(user, gone.id)

      expect(await neighbors(user, target.id)).toEqual({ next: null, previous: 'Older' })
      expect(await neighbors(user, older.id)).toEqual({ next: 'Target', previous: null })
    })

    test('null for a target that is not a live Journal entry', async () => {
      const user = getTestUser()
      const activityId = await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T09:30:00Z'),
        source: 'manual',
        start_time: new Date('2024-01-15T09:00:00Z'),
      })
      const root = await insertNote(user, 'time', null, 'Root', new Date('2024-01-15T08:00:00Z'))
      const reply = await insertNote(user, 'note', root.id, 'Reply', new Date('2024-01-15T08:00:00Z'))
      const comment = await insertNote(
        user,
        'activity',
        activityId,
        'Comment',
        new Date('2024-01-15T09:00:00Z'),
      )
      const gone = await insertNote(user, 'time', null, 'Gone', new Date('2024-01-15T10:00:00Z'))
      await softDeleteNote(user, gone.id)

      expect(await neighbors(user, reply.id)).toBeNull()
      expect(await neighbors(user, comment.id)).toBeNull()
      expect(await neighbors(user, gone.id)).toBeNull()
      expect(await neighbors(user, randomUUID())).toBeNull()
      expect(await neighbors(user, 'not-a-uuid')).toBeNull()
      expect(await neighbors(user, root.id)).toEqual({ next: null, previous: null })
    })
  })

  describe('listNoteTags', () => {
    const tagsOf = (
      user: string,
      entityTypes: ('time' | 'day' | 'activity')[] = ['time', 'day'],
      tz = 'UTC',
    ) => listNoteTags(user, { entity_types: entityTypes, tz })

    test('counts each note once, explicit tag or hashtag, most used first, then by name', async () => {
      const user = getTestUser()
      await insertNote(user, 'time', null, 'A #run', new Date('2024-01-15T08:00:00Z'), undefined, {
        hashtags: ['run'],
        tags: ['run', 'travel'],
      })
      await insertNote(user, 'time', null, 'B', new Date('2024-01-16T08:00:00Z'), undefined, {
        tags: ['run'],
      })
      await insertNote(user, 'time', null, 'C #family', new Date('2024-01-10T08:00:00Z'), undefined, {
        hashtags: ['family'],
      })

      expect(await tagsOf(user)).toEqual([
        { count: 2, last_used: new Date('2024-01-16T08:00:00Z'), tag: 'run' },
        { count: 1, last_used: new Date('2024-01-10T08:00:00Z'), tag: 'family' },
        { count: 1, last_used: new Date('2024-01-15T08:00:00Z'), tag: 'travel' },
      ])
    })

    test("a day entry's last use is the start of its date in tz", async () => {
      const user = getTestUser()
      await insertNote(user, 'day', null, 'Day', undefined, undefined, { date: '2024-01-15', tags: ['trip'] })

      expect(await tagsOf(user)).toEqual([
        { count: 1, last_used: new Date('2024-01-15T00:00:00Z'), tag: 'trip' },
      ])
      expect(await tagsOf(user, ['time', 'day'], 'Europe/Stockholm')).toEqual([
        { count: 1, last_used: new Date('2024-01-14T23:00:00Z'), tag: 'trip' },
      ])
    })

    test('leaves out deleted notes, replies and root types not asked for', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T09:00:00Z')
      const activityId = await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T09:30:00Z'),
        source: 'manual',
        start_time: start,
      })
      const root = await insertNote(user, 'time', null, 'Root', start, undefined, { tags: ['kept'] })
      await insertNote(user, 'note', root.id, 'Reply #reply', start, undefined, { hashtags: ['reply'] })
      const gone = await insertNote(user, 'time', null, 'Gone', start, undefined, { tags: ['gone'] })
      await softDeleteNote(user, gone.id)
      await insertNote(user, 'activity', activityId, 'On it', start, undefined, { tags: ['workout'] })

      expect((await tagsOf(user)).map((t) => t.tag)).toEqual(['kept'])
      expect((await tagsOf(user, ['time', 'activity'])).map((t) => t.tag)).toEqual(['kept', 'workout'])
    })
  })

  describe('getNotesWithAnyTag', () => {
    test('every live note carrying one of the tags, replies and comments included', async () => {
      const user = getTestUser()
      const start = new Date('2024-01-15T09:00:00Z')
      const activityId = await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T09:30:00Z'),
        source: 'manual',
        start_time: start,
      })
      const root = await insertNote(user, 'time', null, 'Root', start, undefined, { tags: ['run'] })
      const reply = await insertNote(user, 'note', root.id, 'Reply #jog', start, undefined, {
        hashtags: ['jog'],
      })
      const comment = await insertNote(user, 'activity', activityId, 'On it', start, undefined, {
        tags: ['run'],
      })
      await insertNote(user, 'time', null, 'Other', start, undefined, { tags: ['walk'] })
      const gone = await insertNote(user, 'time', null, 'Gone', start, undefined, { tags: ['run'] })
      await softDeleteNote(user, gone.id)

      expect((await getNotesWithAnyTag(user, ['run', 'jog'])).map((n) => n.id).sort()).toEqual(
        [root.id, reply.id, comment.id].sort(),
      )
      expect(await getNotesWithAnyTag(user, ['nothing'])).toEqual([])
    })
  })
})
