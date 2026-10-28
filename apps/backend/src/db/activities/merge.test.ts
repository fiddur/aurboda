import { describe, expect, test } from 'vitest'

import type { Activity } from '../types.ts'

import { mergeOverlappingActivities, pickOverrideWinner } from './merge.ts'

const garmin = (overrides: Partial<Activity> = {}): Activity => ({
  activity_type: 'meditation',
  end_time: new Date('2026-05-05T10:30:00Z'),
  id: 'garmin-id',
  source: 'garmin',
  start_time: new Date('2026-05-05T10:00:00Z'),
  title: 'Meditation',
  ...overrides,
})

const override = (overrides: Partial<Activity> = {}): Activity => ({
  activity_type: 'pipe_ceremony',
  end_time: new Date('2026-05-05T10:20:00Z'), // narrower than source
  id: 'aurboda-id',
  override_target_ids: ['garmin-id'],
  source: 'aurboda',
  start_time: new Date('2026-05-05T10:05:00Z'), // narrower than source
  title: 'Pipe ceremony',
  ...overrides,
})

const categoryMap = new Map<string, string>([
  ['meditation', 'meditation'],
  ['pipe_ceremony', 'wellness'],
])

describe('pickOverrideWinner', () => {
  test('returns the aurboda row whose override_target_ids names a member', () => {
    const ov = override()
    expect(pickOverrideWinner([garmin(), ov])).toBe(ov)
  })

  test('returns undefined when no member is an override', () => {
    const healthConnect = garmin({ id: 'health-connect-id', source: 'health_connect' })
    expect(pickOverrideWinner([garmin(), healthConnect])).toBeUndefined()
  })

  test('ignores an override whose target is not in the group', () => {
    expect(pickOverrideWinner([garmin(), override({ override_target_ids: ['elsewhere'] })])).toBeUndefined()
  })

  test('picks the earliest-starting override when two are in one group', () => {
    const later = override({ id: 'later-override' })
    const earlier = override({ id: 'earlier-override', start_time: new Date('2026-05-05T10:01:00Z') })
    expect(pickOverrideWinner([garmin(), later, earlier])).toBe(earlier)
  })
})

describe('mergeOverlappingActivities — aurboda override semantics (#732 follow-up)', () => {
  test('override winner uses its own start/end times — not the source span', () => {
    // Daily summary bug: source's wider time window was leaking into the
    // merged result, so the user saw "10:00 – 10:30" instead of the
    // override's narrower edited "10:05 – 10:20".
    const merged = mergeOverlappingActivities([garmin(), override()], categoryMap)
    expect(merged).toHaveLength(1)
    expect(merged[0].start_time).toEqual(new Date('2026-05-05T10:05:00Z'))
    expect(merged[0].end_time).toEqual(new Date('2026-05-05T10:20:00Z'))
  })

  test('override winner uses its own activity_type (not the source type)', () => {
    const merged = mergeOverlappingActivities([garmin(), override()], categoryMap)
    expect(merged[0].activity_type).toBe('pipe_ceremony')
  })

  test('override winner uses its own title — source title does not fill in', () => {
    // Even when the override clears the title (empty string), the source
    // title must NOT leak through; that would be the same "edits vanished"
    // bug as the time-span case.
    const merged = mergeOverlappingActivities(
      [garmin({ title: 'Meditation' }), override({ title: '' })],
      categoryMap,
    )
    expect(merged[0].title).toBe('')
  })

  test('non-override merge still blends (cross-source pairing extends the span)', () => {
    // Sanity: the field-blending behaviour we suppressed for overrides is
    // intentional for the cross-source case (e.g. Garmin + Polar reporting
    // the same physical session — extend to the union of times).
    const polarLike = garmin({
      end_time: new Date('2026-05-05T10:35:00Z'),
      id: 'health-connect-id',
      source: 'health_connect',
      start_time: new Date('2026-05-05T09:55:00Z'),
    })
    const merged = mergeOverlappingActivities([garmin(), polarLike], categoryMap)
    expect(merged).toHaveLength(1)
    // Cross-source merge should still extend to the wider span.
    expect(merged[0].start_time).toEqual(new Date('2026-05-05T09:55:00Z'))
    expect(merged[0].end_time).toEqual(new Date('2026-05-05T10:35:00Z'))
  })

  test('override winner records source_ids for provenance', () => {
    const merged = mergeOverlappingActivities([garmin(), override()], categoryMap)
    expect(merged[0].source_ids).toContain('garmin-id')
    expect(merged[0].source_ids).toContain('aurboda-id')
  })

  test('multi-target override (#735) wins across the entire merged group', () => {
    // The case that motivated multi-target overrides: a cross-source merge
    // group of three sync rows (Garmin + Strava + Health Connect) all
    // claimed by one aurboda override at once.
    const garminRow = garmin({ id: 'garmin-id' })
    const stravaRow = garmin({
      id: 'strava-id',
      source: 'strava',
      start_time: new Date('2026-05-05T10:01:00Z'),
    })
    const healthConnectRow = garmin({
      id: 'hc-id',
      source: 'health_connect',
      start_time: new Date('2026-05-05T10:00:30Z'),
    })
    const multiOverride = override({
      id: 'aurboda-multi',
      override_target_ids: ['garmin-id', 'strava-id', 'hc-id'],
    })

    const merged = mergeOverlappingActivities(
      [garminRow, stravaRow, healthConnectRow, multiOverride],
      categoryMap,
    )
    // All four collapse into one group with the override winning.
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('aurboda-multi')
    expect(merged[0].activity_type).toBe('pipe_ceremony')
    expect(merged[0].source_ids?.sort()).toEqual(['aurboda-multi', 'garmin-id', 'hc-id', 'strava-id'].sort())
  })
})

describe('mergeOverlappingActivities — override target keeps its override through a same-type merge (#1259)', () => {
  // Garmin and Health Connect report the same session; the user edited the Garmin
  // row, so an override targets it. The cross-source pass groups override + target,
  // the same-type pass then adds the Health Connect row to that group — and must
  // keep the target in `source_ids`, or supersession clears its mark.
  const yogaMap = new Map<string, string>([['yoga', 'exercise']])
  const garminYoga = garmin({ activity_type: 'yoga', title: 'Yoga' })
  const overrideYoga = override({
    activity_type: 'yoga',
    end_time: new Date('2026-05-05T10:30:00Z'),
    start_time: new Date('2026-05-05T10:00:00Z'),
    title: 'Hand typed',
  })

  test('a later same-type row joins the group without dropping the target', () => {
    const healthConnect = garmin({
      end_time: new Date('2026-05-05T10:31:00Z'),
      id: 'hc-id',
      source: 'health_connect',
      start_time: new Date('2026-05-05T10:00:30Z'),
      activity_type: 'yoga',
    })
    const merged = mergeOverlappingActivities([garminYoga, overrideYoga, healthConnect], yogaMap)
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('aurboda-id')
    expect(merged[0].title).toBe('Hand typed')
    expect(merged[0].source_ids?.sort()).toEqual(['aurboda-id', 'garmin-id', 'hc-id'])
  })

  test('an earlier same-type row (e.g. a create-mode rule row) absorbs the group without dropping the target', () => {
    const ruleRow = garmin({
      activity_type: 'yoga',
      end_time: new Date('2026-05-05T10:30:00Z'),
      id: 'rule-id',
      source: 'deduction-rule',
      start_time: new Date('2026-05-05T09:59:00Z'),
    })
    const merged = mergeOverlappingActivities([garminYoga, overrideYoga, ruleRow], yogaMap)
    expect(merged).toHaveLength(1)
    expect(merged[0].source_ids?.sort()).toEqual(['aurboda-id', 'garmin-id', 'rule-id'])
  })
})

describe('mergeOverlappingActivities — Health Connect mindfulness session overlapping a Garmin meditation (#1341)', () => {
  const garminMeditation = garmin({
    end_time: new Date('2026-05-05T10:20:00Z'),
    start_time: new Date('2026-05-05T10:00:30Z'),
    title: 'Breathwork',
  })
  const hcMeditation = (overrides: Partial<Activity> = {}): Activity => ({
    activity_type: 'meditation',
    end_time: new Date('2026-05-05T10:21:00Z'),
    id: 'health-connect-id',
    source: 'health_connect',
    start_time: new Date('2026-05-05T10:00:00Z'),
    title: 'Meditation • What Is Real?',
    ...overrides,
  })

  test('merges into one activity spanning both', () => {
    const merged = mergeOverlappingActivities([garminMeditation, hcMeditation()], categoryMap)
    expect(merged).toHaveLength(1)
    expect(merged[0].activity_type).toBe('meditation')
    expect(merged[0].start_time).toEqual(new Date('2026-05-05T10:00:00Z'))
    expect(merged[0].end_time).toEqual(new Date('2026-05-05T10:21:00Z'))
    expect(merged[0].source_ids).toEqual(expect.arrayContaining(['garmin-id', 'health-connect-id']))
    expect(merged[0].source_ids).toHaveLength(2)
  })

  test('stays two activities when the sessions do not overlap', () => {
    const merged = mergeOverlappingActivities(
      [
        garminMeditation,
        hcMeditation({
          end_time: new Date('2026-05-05T10:35:00Z'),
          start_time: new Date('2026-05-05T10:25:00Z'),
        }),
      ],
      categoryMap,
    )
    expect(merged).toHaveLength(2)
    expect(merged.every((m) => m.source_ids === undefined)).toBe(true)
  })
})
