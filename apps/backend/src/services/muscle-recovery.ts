import {
  type ExerciseMuscleGroup,
  exerciseMuscleGroups,
  exerciseMuscleInfo,
  MUSCLE_RECOVERY_MAX_SOURCES,
  MUSCLE_RECOVERY_READY_PERCENT,
  MUSCLE_RECOVERY_SET_FATIGUE,
  MUSCLE_RECOVERY_WINDOW_DAYS,
  type MuscleRecovery,
  type MuscleRecoveryGroup,
  type MuscleRecoveryHistory,
  type MuscleRecoveryHistoryPoint,
  type MuscleRecoverySource,
  type StoredExerciseCatalogEntry,
} from '@aurboda/api-spec'

import type { ExerciseSession, ResolverOf } from './queries/muscle-group-history.ts'

import { isWorkingItem, normalizeItemValue } from './activity-measures.ts'
import { muscleGroupWeights, round2 } from './muscle-group-measures.ts'

const HOUR_MS = 3_600_000
const WINDOW_MS = MUSCLE_RECOVERY_WINDOW_DAYS * 24 * HOUR_MS
const READY_FATIGUE = 1 - MUSCLE_RECOVERY_READY_PERCENT / 100

const LARGE_GROUPS: ReadonlySet<ExerciseMuscleGroup> = new Set([
  'chest',
  'lats',
  'middle_back',
  'lower_back',
  'quadriceps',
  'hamstrings',
  'glutes',
])

export const MUSCLE_RECOVERY_HALF_LIFE_HOURS = Object.fromEntries(
  exerciseMuscleGroups.map((group) => [group, LARGE_GROUPS.has(group) ? 36 : 24]),
) as Record<ExerciseMuscleGroup, number>

const finite = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/** How hard a set was, from its `set_type`, `rpe` or `rir`: 1.2 near failure, 0.7 easy, else 1. */
export const setEffort = (item: Record<string, unknown>): number => {
  const rpe = finite(item.rpe)
  const rir = finite(item.rir)
  const failure = typeof item.set_type === 'string' && item.set_type.trim().toLowerCase() === 'failure'
  if (failure || (rpe !== undefined && rpe >= 9) || (rir !== undefined && rir <= 1)) return 1.2
  if ((rpe !== undefined && rpe <= 6) || (rir !== undefined && rir >= 4)) return 0.7
  return 1
}

export interface FatigueRecord {
  activity_type: string
  end_time: Date
  fatigue: number
  muscle_group: ExerciseMuscleGroup
  session_id: string
  /** Working sets weighted by recruitment and effort. */
  sets: number
  start_time: Date
  title?: string
}

/** Per session and muscle group, the weighted working sets whose exercise resolves to the catalogue. */
export const fatigueSets = (
  sessions: ExerciseSession[],
  key: string,
  resolverOf: ResolverOf,
): FatigueRecord[] => {
  const weights = new Map<string, Partial<Record<ExerciseMuscleGroup, number>> | undefined>()
  const weightsOf = (activityType: string, value: string, normalized: string) =>
    weights.getOrInsertComputed(`${activityType}\u0000${normalized}`, () => {
      const entry: StoredExerciseCatalogEntry | undefined = resolverOf(activityType)(value)
      return entry ? muscleGroupWeights(entry) : undefined
    })
  return sessions.flatMap((session) => {
    const sets = new Map<ExerciseMuscleGroup, number>()
    for (const item of session.items) {
      const normalized = normalizeItemValue(item[key])
      if (normalized === undefined || !isWorkingItem(item)) continue
      const recruitment = weightsOf(session.activity_type, String(item[key]).trim(), normalized)
      if (!recruitment) continue
      const effort = setEffort(item)
      for (const [group, weight] of Object.entries(recruitment) as [ExerciseMuscleGroup, number][]) {
        sets.set(group, (sets.get(group) ?? 0) + weight * effort)
      }
    }
    return [...sets].map(([group, weighted]) => ({
      activity_type: session.activity_type,
      end_time: session.end_time ?? session.start_time,
      fatigue: weighted * MUSCLE_RECOVERY_SET_FATIGUE,
      muscle_group: group,
      session_id: session.id,
      sets: weighted,
      start_time: session.start_time,
      ...(session.title !== undefined && { title: session.title }),
    }))
  })
}

const inWindow = (record: FatigueRecord, at: Date): boolean =>
  record.start_time.getTime() > at.getTime() - WINDOW_MS && record.start_time.getTime() <= at.getTime()

const fatigueLeft = (record: FatigueRecord, at: Date): number => {
  const hours = Math.max(0, at.getTime() - record.end_time.getTime()) / HOUR_MS
  return record.fatigue * 0.5 ** (hours / MUSCLE_RECOVERY_HALF_LIFE_HOURS[record.muscle_group])
}

const recoveryOf = (fatigue: number): number => Math.round(100 * (1 - Math.min(1, fatigue)))

const byGroup = (records: FatigueRecord[], at: Date): Map<ExerciseMuscleGroup, FatigueRecord[]> => {
  const groups = new Map<ExerciseMuscleGroup, FatigueRecord[]>()
  for (const record of records) {
    if (inWindow(record, at)) groups.getOrInsertComputed(record.muscle_group, () => []).push(record)
  }
  return groups
}

const toSource = (record: FatigueRecord, left: number): MuscleRecoverySource => ({
  activity_type: record.activity_type,
  end_time: record.end_time.toISOString(),
  fatigue: round2(left),
  session_id: record.session_id,
  sets: round2(record.sets),
  start_time: record.start_time.toISOString(),
  ...(record.title !== undefined && { title: record.title }),
})

const groupRecovery = (
  group: ExerciseMuscleGroup,
  records: FatigueRecord[],
  at: Date,
): MuscleRecoveryGroup => {
  const halfLife = MUSCLE_RECOVERY_HALF_LIFE_HOURS[group]
  const left = records
    .map((record) => ({ left: fatigueLeft(record, at), record }))
    .toSorted((a, b) => b.left - a.left || b.record.end_time.getTime() - a.record.end_time.getTime())
  const fatigue = left.reduce((sum, l) => sum + l.left, 0)
  return {
    fatigue: round2(fatigue),
    half_life_hours: halfLife,
    muscle_group: group,
    name: exerciseMuscleInfo[group].name,
    ready_at:
      fatigue <= READY_FATIGUE
        ? null
        : new Date(at.getTime() + halfLife * Math.log2(fatigue / READY_FATIGUE) * HOUR_MS).toISOString(),
    recovery: recoveryOf(fatigue),
    sources: left
      .filter((l) => round2(l.left) > 0)
      .slice(0, MUSCLE_RECOVERY_MAX_SOURCES)
      .map((l) => toSource(l.record, l.left)),
  }
}

export const muscleRecoveryAt = (records: FatigueRecord[], at: Date, field: string): MuscleRecovery => {
  const groups = byGroup(records, at)
  return {
    at: at.toISOString(),
    field,
    groups: exerciseMuscleGroups.map((group) => groupRecovery(group, groups.get(group) ?? [], at)),
    ready_percent: MUSCLE_RECOVERY_READY_PERCENT,
    window_days: MUSCLE_RECOVERY_WINDOW_DAYS,
  }
}

const pointAt = (records: FatigueRecord[], at: Date): MuscleRecoveryHistoryPoint => {
  const groups = byGroup(records, at)
  const fatigueOf = (group: ExerciseMuscleGroup) =>
    (groups.get(group) ?? []).reduce((sum, record) => sum + fatigueLeft(record, at), 0)
  return {
    at: at.toISOString(),
    recovery: Object.fromEntries(
      exerciseMuscleGroups.map((group) => [group, recoveryOf(fatigueOf(group))]),
    ) as Record<ExerciseMuscleGroup, number>,
  }
}

/** The moments of a history: `end` and every `step_hours` before it down to `start`, oldest first. */
export const recoveryMoments = (period: { end: Date; start: Date; step_hours: number }): Date[] => {
  const moments: Date[] = []
  for (let t = period.end.getTime(); t >= period.start.getTime(); t -= period.step_hours * HOUR_MS) {
    moments.push(new Date(t))
  }
  return moments.toReversed()
}

export const muscleRecoveryHistory = (
  records: FatigueRecord[],
  period: { end: Date; start: Date; step_hours: number },
  field: string,
): MuscleRecoveryHistory => ({
  end: period.end.toISOString(),
  field,
  points: recoveryMoments(period).map((at) => pointAt(records, at)),
  start: period.start.toISOString(),
  step_hours: period.step_hours,
})
