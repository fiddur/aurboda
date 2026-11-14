import { describe, expect, test } from 'vitest'

import type { Activity } from '../types.ts'

import { blendData, mergeGroupByPriority, mergeOverlappingActivities, pickOverrideWinner } from './merge.ts'

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

describe('mergeGroupByPriority', () => {
  test('blends data with the higher-priority source winning and fills the title from the first that has one', () => {
    const gravl = garmin({
      activity_type: 'strength_training',
      data: { calories: 250, sets: [{ reps: 8 }] },
      id: 'gravl-id',
      source: 'gravl',
      title: undefined,
    })
    const merged = mergeGroupByPriority([garmin({ data: { avg_hr: 110, calories: 300 } }), gravl])
    expect(merged.id).toBe('gravl-id')
    expect(merged.data).toEqual({ avg_hr: 110, calories: 250, sets: [{ reps: 8 }] })
    expect(merged.title).toBe('Meditation')
    expect(merged.source_ids).toEqual(['gravl-id', 'garmin-id'])
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

describe('mergeOverlappingActivities — same-type rows that only touch (#981, #1488)', () => {
  const yoga = (overrides: Partial<Activity>): Activity => ({
    activity_type: 'yoga',
    end_time: new Date('2026-11-06T21:30:00Z'),
    id: 'first',
    source: 'manual',
    start_time: new Date('2026-11-06T21:00:00Z'),
    ...overrides,
  })
  const second = (overrides: Partial<Activity> = {}): Activity =>
    yoga({
      end_time: new Date('2026-11-06T22:00:00Z'),
      id: 'second',
      start_time: new Date('2026-11-06T21:30:00Z'),
      ...overrides,
    })

  test('two back-to-back manual sessions stay two activities', () => {
    const merged = mergeOverlappingActivities([yoga({}), second()])
    expect(merged.map((m) => m.id)).toEqual(['first', 'second'])
    expect(merged.every((m) => m.source_ids === undefined)).toBe(true)
  })

  test('stay apart with a category map too, across discrete sources', () => {
    const merged = mergeOverlappingActivities(
      [yoga({ source: 'aurboda' }), second({ source: 'garmin' })],
      new Map([['yoga', 'exercise']]),
    )
    expect(merged).toHaveLength(2)
  })

  test('a real overlap still merges', () => {
    const merged = mergeOverlappingActivities([
      yoga({}),
      second({ start_time: new Date('2026-11-06T21:29:00Z') }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].end_time).toEqual(new Date('2026-11-06T22:00:00Z'))
    expect(merged[0].source_ids).toEqual(['first', 'second'])
  })

  test('touching spans from a fragmenting source still join', () => {
    const merged = mergeOverlappingActivities([
      yoga({ activity_type: 'screentime', source: 'activitywatch' }),
      second({ activity_type: 'screentime', source: 'activitywatch' }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].start_time).toEqual(new Date('2026-11-06T21:00:00Z'))
    expect(merged[0].end_time).toEqual(new Date('2026-11-06T22:00:00Z'))
  })

  test('a fragmenting row on either side of the touch bridges it', () => {
    expect(mergeOverlappingActivities([yoga({ source: 'deduction-rule' }), second()])).toHaveLength(1)
    expect(mergeOverlappingActivities([yoga({}), second({ source: 'health_connect' })])).toHaveLength(1)
  })

  test('any source outside the discrete list bridges a touch, as before', () => {
    expect(mergeOverlappingActivities([yoga({ source: 'owntracks' }), second()])).toHaveLength(1)
  })

  test('the row ending the run decides, not the run’s first row', () => {
    // A manual session overlapped by a Health Connect fragment that ends it, then a manual
    // session touching that end: the fragment bridges the touch.
    const fragment = yoga({
      end_time: new Date('2026-11-06T21:30:00Z'),
      id: 'fragment',
      source: 'health_connect',
      start_time: new Date('2026-11-06T21:10:00Z'),
    })
    const shortManual = yoga({ end_time: new Date('2026-11-06T21:20:00Z') })
    expect(mergeOverlappingActivities([shortManual, fragment, second()])).toHaveLength(1)

    // The other way round: a fragment inside a manual session that ends the run, then a manual
    // session touching it — two discrete rows meet at the touch, so they stay apart.
    const inner = yoga({
      end_time: new Date('2026-11-06T21:20:00Z'),
      id: 'inner',
      source: 'health_connect',
      start_time: new Date('2026-11-06T21:05:00Z'),
    })
    const merged = mergeOverlappingActivities([yoga({}), inner, second()])
    expect(merged).toHaveLength(2)
    expect(merged[0].source_ids).toEqual(['first', 'inner'])
    expect(merged[1].id).toBe('second')
  })

  test('two point-in-time rows at the same instant still merge', () => {
    const point = yoga({ end_time: undefined })
    expect(mergeOverlappingActivities([point, { ...point, id: 'again' }])).toHaveLength(1)
  })
})

describe('blendData — sets imported from Garmin never hide logged sets', () => {
  const logged = [{ exercise: 'Bench Press', reps: 8 }]
  const fromGarmin = [{ exercise: 'Barbell Bench Press', reps: 7 }]
  const otherLogged = [{ exercise: 'Squat', reps: 5 }]

  test('garmin sets over logged sets keep the logged sets, without a sets_source', () => {
    expect(blendData({ a: 1, sets: logged }, { b: 2, sets: fromGarmin, sets_source: 'garmin' })).toEqual({
      a: 1,
      b: 2,
      sets: logged,
    })
  })

  test('logged sets over garmin sets win, and the garmin sets_source goes with its sets', () => {
    expect(blendData({ sets: fromGarmin, sets_source: 'garmin' }, { sets: logged })).toEqual({ sets: logged })
  })

  test('garmin over garmin: the later wins as today', () => {
    const later = [{ exercise: 'Later', reps: 1 }]
    expect(
      blendData({ sets: fromGarmin, sets_source: 'garmin' }, { sets: later, sets_source: 'garmin' }),
    ).toEqual({ sets: later, sets_source: 'garmin' })
  })

  test('logged over logged: the later wins as today', () => {
    expect(blendData({ sets: logged }, { sets: otherLogged })).toEqual({ sets: otherLogged })
  })

  test('garmin sets over an empty sets list take over', () => {
    expect(blendData({ sets: [] }, { sets: fromGarmin, sets_source: 'garmin' })).toEqual({
      sets: fromGarmin,
      sets_source: 'garmin',
    })
  })

  test('an over without a sets key keeps the pair from under', () => {
    expect(blendData({ sets: fromGarmin, sets_source: 'garmin' }, { average_hr: 120 })).toEqual({
      average_hr: 120,
      sets: fromGarmin,
      sets_source: 'garmin',
    })
    expect(blendData(undefined, { average_hr: 120 })).toEqual({ average_hr: 120 })
  })

  test("no stray sets_source is left next to the other side's sets", () => {
    expect(blendData({ sets: logged }, { sets: [], sets_source: 'garmin' })).toEqual({
      sets: [],
      sets_source: 'garmin',
    })
    expect(blendData({ sets_source: 'garmin' }, { sets: logged })).toEqual({ sets: logged })
  })
})

describe('mergeOverlappingActivities — a Garmin strength session with sets next to a Gravl log (#1652)', () => {
  const strengthMap = new Map<string, string>([['strength_training', 'exercise']])
  const gravlSets = [{ exercise: 'Bench Press', reps: 8, weight: 60 }]
  const garminSetList = [{ exercise: 'Barbell Bench Press', reps: 7, weight: 60 }]

  const garminRow = (start: string): Activity => ({
    activity_type: 'strength_training',
    data: { average_hr: 110, garmin_activity_id: 99, sets: garminSetList, sets_source: 'garmin' },
    end_time: new Date('2026-11-10T08:00:00Z'),
    id: 'garmin-strength',
    source: 'garmin',
    start_time: new Date(start),
    title: 'Strength',
  })

  const gravlRow = (start: string): Activity => ({
    activity_type: 'strength_training',
    data: { gravl_workout_id: 'w1', sets: gravlSets },
    end_time: new Date('2026-11-10T07:55:00Z'),
    id: 'gravl-strength',
    source: 'gravl',
    start_time: new Date(start),
    title: 'Push day',
  })

  test.each([
    ['Garmin first', '2026-11-10T07:00:00Z', '2026-11-10T07:02:00Z'],
    ['Gravl first', '2026-11-10T07:02:00Z', '2026-11-10T07:00:00Z'],
  ])(
    '%s: the merged session shows the Gravl sets and keeps the Garmin keys',
    (_, garminStart, gravlStart) => {
      const merged = mergeOverlappingActivities([garminRow(garminStart), gravlRow(gravlStart)], strengthMap)

      expect(merged).toHaveLength(1)
      expect(merged[0].data?.sets).toEqual(gravlSets)
      expect(merged[0].data).not.toHaveProperty('sets_source')
      expect(merged[0].data).toMatchObject({ average_hr: 110, garmin_activity_id: 99 })
    },
  )

  test('a Garmin row alone keeps its sets and their source', () => {
    const [merged] = mergeOverlappingActivities([garminRow('2026-11-10T07:00:00Z')], strengthMap)

    expect(merged.data).toMatchObject({ sets: garminSetList, sets_source: 'garmin' })
  })

  test("a cross-source group won by a Garmin row with sets keeps the member's logged sets", () => {
    const winner = { ...garminRow('2026-11-10T07:00:00Z'), activity_type: 'hiit' }
    const member = { ...gravlRow('2026-11-10T07:01:00Z'), source: 'health_connect' as const }

    const merged = mergeGroupByPriority([winner, member])

    expect(merged.id).toBe('garmin-strength')
    expect(merged.data?.sets).toEqual(gravlSets)
    expect(merged.data).not.toHaveProperty('sets_source')
    expect(merged.data).toMatchObject({ average_hr: 110 })
  })
})
