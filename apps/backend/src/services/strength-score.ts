import {
  type BiologicalSex,
  STRENGTH_SCORE_GROUP_LIFTS,
  STRENGTH_SCORE_MAX_REPS,
  STRENGTH_SCORE_WINDOW_DAYS,
  type StoredExerciseCatalogEntry,
  type StrengthScore,
  type StrengthScoreGroup,
  type StrengthScoreGroupResult,
  type StrengthScoreHistory,
  type StrengthScoreHistoryPoint,
  type StrengthScoreLift,
  type StrengthScoreMissing,
  type StrengthScoreSet,
} from '@aurboda/api-spec'

import type { ExerciseSession, ResolverOf } from './queries/muscle-group-history.ts'
import type { StrengthReferenceLift, StrengthReferences } from './strength-references.ts'

import { isWorkingItem, normalizeItemValue } from './activity-measures.ts'

const DAY_MS = 86_400_000
const WINDOW_MS = STRENGTH_SCORE_WINDOW_DAYS * DAY_MS

export interface ScoredSet {
  activity_type: string
  bodyweight?: number
  catalog_key: string
  e1rm: number
  lift: StrengthReferenceLift
  reps: number
  session_id: string
  start_time: Date
  value: string
  weight: number
}

/** What a score needs and the user has not given. */
export interface StrengthScoreSubject {
  has_bodyweight: boolean
  sex: BiologicalSex | undefined
}

/** The bodyweight at a moment: the latest value at or before it, else the earliest after it. */
export const bodyweightLookup = (series: [Date, number][]): ((at: Date) => number | undefined) => {
  const times = series.map(([time]) => time.getTime())
  return (at) => {
    if (series.length === 0) return undefined
    let low = 0
    let high = times.length
    while (low < high) {
      const mid = (low + high) >> 1
      if ((times[mid] as number) <= at.getTime()) low = mid + 1
      else high = mid
    }
    return (series[Math.max(low - 1, 0)] as [Date, number])[1]
  }
}

export const epley = (weight: number, reps: number): number => weight * (1 + reps / 30)

export const referenceE1rm = (
  ratio: number,
  bodyweight: number,
  references: Pick<StrengthReferences, 'bodyweight_exponent' | 'reference_bodyweight_kg'>,
): number => {
  const r = references.reference_bodyweight_kg
  return ratio * r * (bodyweight / r) ** references.bodyweight_exponent
}

const finite = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

const loadOf = (item: Record<string, unknown>): { reps: number; weight: number } | undefined => {
  if (!isWorkingItem(item)) return undefined
  const weight = finite(item.weight)
  const reps = finite(item.reps)
  if (weight === undefined || weight <= 0 || reps === undefined) return undefined
  return reps >= 1 && reps <= STRENGTH_SCORE_MAX_REPS ? { reps, weight } : undefined
}

/** Every working set of 1 to 12 reps with a weight whose exercise resolves to a reference lift. */
export const scoredSets = (
  sessions: ExerciseSession[],
  key: string,
  resolverOf: ResolverOf,
  references: StrengthReferences,
  bodyweightAt: (at: Date) => number | undefined,
): ScoredSet[] => {
  const entries = new Map<string, StoredExerciseCatalogEntry | undefined>()
  const entryOf = (activityType: string, value: string, normalized: string) =>
    entries.getOrInsertComputed(`${activityType}\u0000${normalized}`, () => resolverOf(activityType)(value))
  return sessions.flatMap((session) => {
    const bodyweight = bodyweightAt(session.start_time)
    return session.items.flatMap((item): ScoredSet[] => {
      const normalized = normalizeItemValue(item[key])
      const load = loadOf(item)
      if (normalized === undefined || load === undefined) return []
      const value = String(item[key]).trim()
      const entry = entryOf(session.activity_type, value, normalized)
      const lift = entry ? references.liftByCatalogKey.get(entry.key) : undefined
      if (!entry || !lift) return []
      return [
        {
          activity_type: session.activity_type,
          ...(bodyweight !== undefined && { bodyweight }),
          catalog_key: entry.key,
          e1rm: epley(load.weight, load.reps),
          lift,
          reps: load.reps,
          session_id: session.id,
          start_time: session.start_time,
          value,
          weight: load.weight,
        },
      ]
    })
  })
}

export const missingOf = ({ has_bodyweight, sex }: StrengthScoreSubject): StrengthScoreMissing[] => [
  ...(sex === undefined ? (['sex'] as const) : []),
  ...(has_bodyweight ? [] : (['bodyweight'] as const)),
]

interface RatedSet {
  points?: number
  reference?: number
  set: ScoredSet
}

const rate = (set: ScoredSet, references: StrengthReferences, sex: BiologicalSex | undefined): RatedSet => {
  if (sex === undefined || set.bodyweight === undefined) return { set }
  const reference = referenceE1rm(set.lift.ratio[sex], set.bodyweight, references)
  return { points: (100 * set.e1rm) / reference, reference, set }
}

const rank = (rated: RatedSet): number => rated.points ?? rated.set.e1rm

const beats = (a: RatedSet, b: RatedSet): boolean =>
  rank(a) > rank(b) || (rank(a) === rank(b) && a.set.start_time.getTime() > b.set.start_time.getTime())

const inWindow = (time: Date, at: Date): boolean =>
  time.getTime() > at.getTime() - WINDOW_MS && time.getTime() <= at.getTime()

const bestByLift = (
  sets: ScoredSet[],
  references: StrengthReferences,
  sex: BiologicalSex | undefined,
  at: Date,
): Map<string, RatedSet> => {
  const best = new Map<string, RatedSet>()
  for (const set of sets) {
    if (!inWindow(set.start_time, at)) continue
    const rated = rate(set, references, sex)
    const previous = best.get(set.lift.id)
    if (!previous || beats(rated, previous)) best.set(set.lift.id, rated)
  }
  return best
}

const round1 = (v: number): number => Math.round(v * 10) / 10

const toSet = ({ reference, set }: RatedSet): StrengthScoreSet => ({
  activity_type: set.activity_type,
  ...(set.bodyweight !== undefined && { bodyweight: set.bodyweight }),
  catalog_key: set.catalog_key,
  e1rm: round1(set.e1rm),
  ...(reference !== undefined && { reference_e1rm: round1(reference) }),
  reps: set.reps,
  session_id: set.session_id,
  start_time: set.start_time.toISOString(),
  value: set.value,
  weight: set.weight,
})

const mean = (values: number[]): number | undefined =>
  values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : undefined

interface GroupScore {
  counted: Set<string>
  mean?: number
}

const scoreGroup = (
  lifts: StrengthReferenceLift[],
  best: Map<string, RatedSet>,
  scoring: boolean,
): GroupScore => {
  if (!scoring) return { counted: new Set() }
  const top = lifts
    .flatMap((lift) => {
      const points = best.get(lift.id)?.points
      return points === undefined ? [] : [{ id: lift.id, points }]
    })
    .toSorted((a, b) => b.points - a.points)
    .slice(0, STRENGTH_SCORE_GROUP_LIFTS)
  const groupMean = mean(top.map((t) => t.points))
  return { counted: new Set(top.map((t) => t.id)), ...(groupMean !== undefined && { mean: groupMean }) }
}

const toLift = (
  lift: StrengthReferenceLift,
  rated: RatedSet | undefined,
  counted: Set<string>,
  scoring: boolean,
): StrengthScoreLift => ({
  ...(rated && { best: toSet(rated) }),
  catalog_keys: lift.keys,
  counted: counted.has(lift.id),
  ...(rated && { expires_at: new Date(rated.set.start_time.getTime() + WINDOW_MS).toISOString() }),
  lift: lift.id,
  name: lift.name,
  score: scoring && rated?.points !== undefined ? Math.round(rated.points) : null,
})

const orderLifts = (lifts: StrengthReferenceLift[], best: Map<string, RatedSet>): StrengthReferenceLift[] => {
  const withBest = lifts.filter((lift) => best.has(lift.id))
  return [
    ...withBest.toSorted((a, b) => rank(best.get(b.id) as RatedSet) - rank(best.get(a.id) as RatedSet)),
    ...lifts.filter((lift) => !best.has(lift.id)),
  ]
}

interface ScoredGroup {
  mean?: number
  result: StrengthScoreGroupResult
}

const scoreGroups = (
  sets: ScoredSet[],
  references: StrengthReferences,
  subject: StrengthScoreSubject,
  at: Date,
): ScoredGroup[] => {
  const scoring = missingOf(subject).length === 0
  const best = bestByLift(sets, references, subject.sex, at)
  return references.groups.map((group) => {
    const lifts = references.lifts.filter((lift) => lift.group === group.key)
    const score = scoreGroup(lifts, best, scoring)
    return {
      ...(score.mean !== undefined && { mean: score.mean }),
      result: {
        group: group.key,
        lifts: orderLifts(lifts, best).map((lift) => toLift(lift, best.get(lift.id), score.counted, scoring)),
        muscle_groups: group.muscle_groups,
        name: group.name,
        score: score.mean === undefined ? null : Math.round(score.mean),
      },
    }
  })
}

const overallOf = (groups: ScoredGroup[]): number | null => {
  const overall = mean(groups.flatMap((g) => (g.mean === undefined ? [] : [g.mean])))
  return overall === undefined ? null : Math.round(overall)
}

export const strengthScoreAt = (
  sets: ScoredSet[],
  references: StrengthReferences,
  subject: StrengthScoreSubject,
  at: Date,
  field: string,
): StrengthScore => {
  const groups = scoreGroups(sets, references, subject, at)
  return {
    at: at.toISOString(),
    field,
    groups: groups.map((g) => g.result),
    missing: missingOf(subject),
    score: overallOf(groups),
    window_days: STRENGTH_SCORE_WINDOW_DAYS,
  }
}

const pointAt = (
  sets: ScoredSet[],
  references: StrengthReferences,
  subject: StrengthScoreSubject,
  at: Date,
): StrengthScoreHistoryPoint => {
  const groups = scoreGroups(sets, references, subject, at)
  const scores: Partial<Record<StrengthScoreGroup, number>> = {}
  for (const { result } of groups) if (result.score !== null) scores[result.group] = result.score
  return { at: at.toISOString(), groups: scores, score: overallOf(groups) }
}

/** The moments of a history: `end` and every `step_days` before it down to `start`, oldest first. */
export const historyMoments = (period: { end: Date; start: Date; step_days: number }): Date[] => {
  const moments: Date[] = []
  for (let t = period.end.getTime(); t >= period.start.getTime(); t -= period.step_days * DAY_MS) {
    moments.push(new Date(t))
  }
  return moments.toReversed()
}

export const strengthScoreHistory = (
  sets: ScoredSet[],
  references: StrengthReferences,
  subject: StrengthScoreSubject,
  period: { end: Date; start: Date; step_days: number },
  field: string,
): StrengthScoreHistory => {
  const missing = missingOf(subject)
  return {
    end: period.end.toISOString(),
    field,
    missing,
    points:
      missing.length > 0 ? [] : historyMoments(period).map((at) => pointAt(sets, references, subject, at)),
    start: period.start.toISOString(),
    step_days: period.step_days,
  }
}
