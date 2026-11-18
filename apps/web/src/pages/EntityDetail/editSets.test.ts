import { describe, expect, it } from 'vitest'

import type { Activity, SourceRecord } from '../../state/api'

import { aurbodaStrengthMemberId, editableSetsRowId } from './editSets'

type Row = Parameters<typeof editableSetsRowId>[0]

const rec = (id: string, source: string, activity_type = 'strength_training'): SourceRecord => ({
  activity_type,
  id,
  source,
  start_time: '2026-11-18T10:00:00Z',
})

const logged: Row = {
  activity_type: 'strength_training',
  data: { sets: [{ exercise: 'Bench Press', reps: 8, weight: 60 }] },
  id: 'aur-1',
  source: 'aurboda',
}

const merged = (records: SourceRecord[], extra: Partial<Activity> = {}): Row => ({
  activity_type: 'strength_training',
  data: { sets: [{ exercise: 'Bench Press', reps: 8, weight: 60 }] },
  id: 'garmin-1',
  source: 'garmin',
  source_records: records,
  ...extra,
})

const group = [rec('garmin-1', 'garmin'), rec('aur-1', 'aurboda')]

describe('aurbodaStrengthMemberId', () => {
  it('names the one aurboda strength member of a merged strength session', () => {
    expect(aurbodaStrengthMemberId(merged(group), true)).toBe('aur-1')
  })

  it('names nothing for a plain view, two aurboda rows, none, another type or a deleted session', () => {
    expect(aurbodaStrengthMemberId(merged(group), false)).toBeUndefined()
    expect(aurbodaStrengthMemberId(merged([...group, rec('aur-2', 'aurboda')]), true)).toBeUndefined()
    expect(
      aurbodaStrengthMemberId(merged([rec('garmin-1', 'garmin'), rec('hc', 'health_connect')]), true),
    ).toBeUndefined()
    expect(
      aurbodaStrengthMemberId(merged([rec('garmin-1', 'garmin'), rec('aur-1', 'aurboda', 'yoga')]), true),
    ).toBeUndefined()
    expect(aurbodaStrengthMemberId(merged(group, { activity_type: 'running' }), true)).toBeUndefined()
    expect(
      aurbodaStrengthMemberId(merged(group, { deleted_at: '2026-11-18T12:00:00Z' }), true),
    ).toBeUndefined()
  })
})

describe('editableSetsRowId', () => {
  it('keeps the plain rule: a logged aurboda strength row edits itself', () => {
    expect(editableSetsRowId(logged, false, undefined)).toBe('aur-1')
    expect(editableSetsRowId({ ...logged, source: 'garmin' }, false, undefined)).toBeNull()
    expect(editableSetsRowId({ ...logged, override_target_ids: ['g'] }, false, undefined)).toBeNull()
    expect(
      editableSetsRowId({ ...logged, data: { ...logged.data, in_progress: true } }, false, undefined),
    ).toBeNull()
  })

  it("edits the merged group's aurboda row once it is fetched and is a finished logged session", () => {
    expect(editableSetsRowId(merged(group), true, logged)).toBe('aur-1')
  })

  it('offers nothing while the member is not loaded, or for another row', () => {
    expect(editableSetsRowId(merged(group), true, undefined)).toBeNull()
    expect(editableSetsRowId(merged(group), true, { ...logged, id: 'other' })).toBeNull()
  })

  it('offers nothing for an override, a session in progress or one without sets', () => {
    expect(
      editableSetsRowId(merged(group), true, { ...logged, override_target_ids: ['garmin-1'] }),
    ).toBeNull()
    expect(
      editableSetsRowId(merged(group), true, { ...logged, data: { ...logged.data, in_progress: true } }),
    ).toBeNull()
    expect(editableSetsRowId(merged(group), true, { ...logged, data: { sets: [] } })).toBeNull()
    expect(editableSetsRowId(merged(group), true, { ...logged, data: {} })).toBeNull()
  })

  it('accepts an empty override list as no override', () => {
    expect(editableSetsRowId(merged(group), true, { ...logged, override_target_ids: [] })).toBe('aur-1')
  })

  it('offers nothing for a group with two aurboda rows', () => {
    expect(editableSetsRowId(merged([...group, rec('aur-2', 'aurboda')]), true, logged)).toBeNull()
  })
})
