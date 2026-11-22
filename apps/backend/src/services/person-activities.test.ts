import { describe, expect, test } from 'vitest'

import type { Activity } from '../db/types.ts'

import { collapseGroup, decodeCursor, encodeCursor, serializePersonActivity } from './person-activities.ts'

const ID_A = '00000000-0000-4000-8000-00000000000a'
const ID_B = '00000000-0000-4000-8000-00000000000b'

const row = (overrides: Partial<Activity>): Activity => ({
  activity_type: 'walking',
  end_time: new Date('2026-11-01T11:00:00Z'),
  source: 'garmin',
  start_time: new Date('2026-11-01T10:00:00Z'),
  ...overrides,
})

describe('cursor', () => {
  test('round-trips the start in microseconds and the id', () => {
    const cursor = { id: ID_A, start_us: '1793527200000123' }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  test.each([
    'not a cursor!',
    '',
    Buffer.from('1793527200000123|not-an-id').toString('base64url'),
    Buffer.from(`yesterday|${ID_A}`).toString('base64url'),
  ])('rejects %j', (raw) => expect(decodeCursor(raw)).toBeNull())
})

describe('collapseGroup', () => {
  test('a lone row is itself, under its own id', () => {
    const lone = row({ id: ID_A })
    const collapsed = collapseGroup(ID_A, [lone], new Map())
    expect(serializePersonActivity(collapsed!).id).toBe(ID_A)
  })

  test('an override and its target are one activity under the merged id, with the override title', () => {
    const synced = row({ id: ID_A, superseded_by: ID_B })
    const override = row({ id: ID_B, override_target_ids: [ID_A], source: 'aurboda', title: 'Stroll' })
    const collapsed = collapseGroup(ID_B, [synced, override], new Map([['walking', 'exercise']]))
    expect(serializePersonActivity(collapsed!)).toMatchObject({ id: `merged:${ID_B}`, title: 'Stroll' })
  })

  test('a group whose own row is gone gives nothing', () => {
    expect(collapseGroup(ID_B, [row({ id: ID_A, superseded_by: ID_B })], new Map())).toBeUndefined()
  })
})
