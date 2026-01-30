/**
 * Database integration tests using testcontainers.
 *
 * These tests run against a real PostgreSQL instance to verify
 * that SQL queries work correctly.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { cleanTestDb, startTestDb, stopTestDb, testQuery } from './test/db-test-helper'

// Increase timeout for container startup
const CONTAINER_TIMEOUT = 60_000

describe('Database Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('tags table', () => {
    test('inserts a tag with ON CONFLICT upsert', async () => {
      // Insert initial tag
      await testQuery(
        `INSERT INTO tags (source, external_id, tag, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source, external_id) DO UPDATE SET
           tag = EXCLUDED.tag,
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time`,
        ['manual', 'tag-1', 'coffee', new Date('2024-01-15T10:00:00Z'), null],
      )

      // Verify inserted
      const result = await testQuery<{ tag: string; external_id: string }>(
        'SELECT tag, external_id FROM tags WHERE external_id = $1',
        ['tag-1'],
      )
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].tag).toBe('coffee')

      // Upsert with same external_id - should update
      await testQuery(
        `INSERT INTO tags (source, external_id, tag, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source, external_id) DO UPDATE SET
           tag = EXCLUDED.tag,
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time`,
        ['manual', 'tag-1', 'tea', new Date('2024-01-15T11:00:00Z'), null],
      )

      // Verify updated (not duplicated)
      const afterUpsert = await testQuery<{ tag: string }>('SELECT tag FROM tags WHERE external_id = $1', [
        'tag-1',
      ])
      expect(afterUpsert.rows).toHaveLength(1)
      expect(afterUpsert.rows[0].tag).toBe('tea')
    })

    test('finds mergeable tag by end_time within time window', async () => {
      // Insert a tag with end_time
      await testQuery(
        `INSERT INTO tags (source, external_id, tag, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          'manual',
          'tag-1',
          'computer:dharma',
          new Date('2024-01-15T09:00:00Z'),
          new Date('2024-01-15T09:59:00Z'),
        ],
      )

      // Find mergeable tag - end_time within 180 seconds of new start_time
      const newStartTime = new Date('2024-01-15T10:00:00Z')
      const earliestMergeTime = new Date(newStartTime.getTime() - 180 * 1000)

      const result = await testQuery<{ external_id: string; tag: string; end_time: Date }>(
        `SELECT external_id, tag, end_time
         FROM tags
         WHERE tag = $1
           AND source = 'manual'
           AND (
             (end_time IS NOT NULL AND end_time >= $2 AND end_time <= $3)
             OR (end_time IS NULL AND start_time >= $2 AND start_time <= $3)
           )
         ORDER BY COALESCE(end_time, start_time) DESC
         LIMIT 1`,
        ['computer:dharma', earliestMergeTime, newStartTime],
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].external_id).toBe('tag-1')
    })

    test('finds mergeable point-in-time tag (no end_time) within time window', async () => {
      // Insert a point-in-time tag (no end_time)
      await testQuery(
        `INSERT INTO tags (source, external_id, tag, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5)`,
        ['manual', 'tag-2', 'coffee', new Date('2024-01-15T09:58:00Z'), null],
      )

      // Find mergeable tag - start_time within 180 seconds of new start_time
      const newStartTime = new Date('2024-01-15T10:00:00Z')
      const earliestMergeTime = new Date(newStartTime.getTime() - 180 * 1000)

      const result = await testQuery<{ external_id: string; tag: string }>(
        `SELECT external_id, tag
         FROM tags
         WHERE tag = $1
           AND source = 'manual'
           AND (
             (end_time IS NOT NULL AND end_time >= $2 AND end_time <= $3)
             OR (end_time IS NULL AND start_time >= $2 AND start_time <= $3)
           )
         ORDER BY COALESCE(end_time, start_time) DESC
         LIMIT 1`,
        ['coffee', earliestMergeTime, newStartTime],
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].external_id).toBe('tag-2')
    })

    test('does not find tag outside merge window', async () => {
      // Insert a tag with end_time too old
      await testQuery(
        `INSERT INTO tags (source, external_id, tag, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          'manual',
          'tag-3',
          'computer:dharma',
          new Date('2024-01-15T09:00:00Z'),
          new Date('2024-01-15T09:50:00Z'),
        ],
      )

      // Find mergeable tag - should NOT find (end_time is 10 minutes before new start)
      const newStartTime = new Date('2024-01-15T10:00:00Z')
      const earliestMergeTime = new Date(newStartTime.getTime() - 180 * 1000) // 3 minutes

      const result = await testQuery(
        `SELECT external_id
         FROM tags
         WHERE tag = $1
           AND source = 'manual'
           AND (
             (end_time IS NOT NULL AND end_time >= $2 AND end_time <= $3)
             OR (end_time IS NULL AND start_time >= $2 AND start_time <= $3)
           )
         ORDER BY COALESCE(end_time, start_time) DESC
         LIMIT 1`,
        ['computer:dharma', earliestMergeTime, newStartTime],
      )

      expect(result.rows).toHaveLength(0)
    })

    test('updates tag end_time', async () => {
      // Insert a tag
      await testQuery(
        `INSERT INTO tags (source, external_id, tag, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5)`,
        ['manual', 'tag-4', 'meditation', new Date('2024-01-15T10:00:00Z'), new Date('2024-01-15T10:30:00Z')],
      )

      // Update end_time
      const newEndTime = new Date('2024-01-15T11:00:00Z')
      const updateResult = await testQuery(`UPDATE tags SET end_time = $1 WHERE external_id = $2`, [
        newEndTime,
        'tag-4',
      ])

      expect(updateResult.rowCount).toBe(1)

      // Verify updated
      const result = await testQuery<{ end_time: Date }>('SELECT end_time FROM tags WHERE external_id = $1', [
        'tag-4',
      ])
      expect(result.rows[0].end_time).toEqual(newEndTime)
    })

    test('deletes tag by external_id', async () => {
      // Insert a tag
      await testQuery(
        `INSERT INTO tags (source, external_id, tag, start_time)
         VALUES ($1, $2, $3, $4)`,
        ['manual', 'tag-to-delete', 'temp', new Date('2024-01-15T10:00:00Z')],
      )

      // Delete it
      const deleteResult = await testQuery(`DELETE FROM tags WHERE external_id = $1`, ['tag-to-delete'])
      expect(deleteResult.rowCount).toBe(1)

      // Verify deleted
      const result = await testQuery('SELECT * FROM tags WHERE external_id = $1', ['tag-to-delete'])
      expect(result.rows).toHaveLength(0)
    })
  })

  describe('time_series table', () => {
    test('inserts time series data with ON CONFLICT upsert', async () => {
      // Insert initial data point
      await testQuery(
        `INSERT INTO time_series (time, metric, value, unit, source)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (time, metric, source) DO UPDATE SET value = EXCLUDED.value`,
        [new Date('2024-01-15T10:00:00Z'), 'heart_rate', 72, 'bpm', 'health_connect'],
      )

      // Verify inserted
      const result = await testQuery<{ value: number }>('SELECT value FROM time_series WHERE metric = $1', [
        'heart_rate',
      ])
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].value).toBe(72)

      // Upsert same key - should update value
      await testQuery(
        `INSERT INTO time_series (time, metric, value, unit, source)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (time, metric, source) DO UPDATE SET value = EXCLUDED.value`,
        [new Date('2024-01-15T10:00:00Z'), 'heart_rate', 80, 'bpm', 'health_connect'],
      )

      // Verify updated (not duplicated)
      const afterUpsert = await testQuery<{ value: number }>(
        'SELECT value FROM time_series WHERE metric = $1',
        ['heart_rate'],
      )
      expect(afterUpsert.rows).toHaveLength(1)
      expect(afterUpsert.rows[0].value).toBe(80)
    })

    test('queries time series by time range', async () => {
      // Insert multiple data points
      await testQuery(
        `INSERT INTO time_series (time, metric, value, unit, source) VALUES
         ($1, 'steps', 1000, 'count', 'health_connect'),
         ($2, 'steps', 2000, 'count', 'health_connect'),
         ($3, 'steps', 3000, 'count', 'health_connect')`,
        [
          new Date('2024-01-15T08:00:00Z'),
          new Date('2024-01-15T12:00:00Z'),
          new Date('2024-01-15T16:00:00Z'),
        ],
      )

      // Query range
      const result = await testQuery<{ value: number }>(
        `SELECT value FROM time_series
         WHERE metric = 'steps'
           AND time >= $1 AND time <= $2
         ORDER BY time`,
        [new Date('2024-01-15T10:00:00Z'), new Date('2024-01-15T18:00:00Z')],
      )

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].value).toBe(2000)
      expect(result.rows[1].value).toBe(3000)
    })
  })

  describe('TIMESTAMPTZ handling', () => {
    test('correctly handles timezone-aware timestamps', async () => {
      // Insert with explicit UTC timestamp
      const utcTime = new Date('2024-01-15T10:00:00Z')
      await testQuery(
        `INSERT INTO tags (source, external_id, tag, start_time)
         VALUES ($1, $2, $3, $4)`,
        ['manual', 'tz-test', 'test', utcTime],
      )

      // Query and verify timestamp is preserved
      const result = await testQuery<{ start_time: Date }>(
        'SELECT start_time FROM tags WHERE external_id = $1',
        ['tz-test'],
      )

      expect(result.rows[0].start_time.toISOString()).toBe('2024-01-15T10:00:00.000Z')
    })
  })
})
