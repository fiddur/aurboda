import { randomUUID } from 'crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper'
import { deleteNote, getNoteById, getNotesForEntity, insertNote, updateNote } from './notes'

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
