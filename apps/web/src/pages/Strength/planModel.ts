import {
  type CreateStrengthPlanBody,
  type ExerciseMuscleGroup,
  exerciseMuscleInfo,
  type MuscleRecovery,
  type StrengthPlan,
  type StrengthPlanSet,
  strengthPlanSetTypes,
} from '@aurboda/api-spec'
import { addDays, format, isBefore, isSameDay, isSameYear, startOfDay } from 'date-fns'

import { recoveryLevel } from '../../components/muscleRecovery/recoveryView'
import {
  blocksFromSets,
  type ExerciseBlock,
  loggedSetCount,
  makeBlockId,
  type MakeId,
  plannedOf,
  sessionSummary,
  type SetRow,
  withExerciseKeys,
} from './sessionModel'

const keyOf = (set: SetRow): string | undefined =>
  typeof set.exercise_key === 'string' && set.exercise_key !== '' ? set.exercise_key : undefined

const withoutKey = (set: SetRow): SetRow => {
  const { exercise_key: _, ...rest } = set
  return rest
}

export const blocksFromPlan = (sets: StrengthPlanSet[], makeId: MakeId = makeBlockId): ExerciseBlock[] =>
  blocksFromSets(sets, makeId).map((b) => {
    const key = b.sets.map(keyOf).find((k) => k !== undefined)
    return { ...b, sets: b.sets.map(withoutKey), ...(key ? { catalog_key: key } : {}) }
  })

export const liveBlocksFromPlan = (sets: StrengthPlanSet[], makeId: MakeId = makeBlockId): ExerciseBlock[] =>
  blocksFromPlan(sets, makeId).map((b) => ({
    ...b,
    planned: b.sets.map((s) => plannedOf(s, { withNote: true })),
    sets: [],
  }))

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined

const isSetType = (v: unknown): v is NonNullable<StrengthPlanSet['set_type']> =>
  strengthPlanSetTypes.some((t) => t === v)

const planSetOf = (set: SetRow, exercise: string): StrengthPlanSet => {
  const key = text(set.exercise_key)
  const note = text(set.note)
  return {
    exercise: text(set.exercise) ?? exercise,
    ...(key ? { exercise_key: key } : {}),
    ...(typeof set.weight === 'number' && Number.isFinite(set.weight) && set.weight >= 0
      ? { weight: set.weight }
      : {}),
    ...(positive(set.reps) ? { reps: set.reps } : {}),
    ...(positive(set.time) ? { time: set.time } : {}),
    ...(isSetType(set.set_type) ? { set_type: set.set_type } : {}),
    ...(note ? { note } : {}),
  }
}

export const planSetsFromBlocks = (blocks: ExerciseBlock[]): StrengthPlanSet[] =>
  blocks.flatMap((b) => withExerciseKeys([b]).map((s) => planSetOf(s, b.exercise)))

const localDay = (day: string): Date | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return undefined
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

export const planDayLabel = (plannedFor: string | null, now: Date): string | undefined => {
  if (plannedFor === null) return undefined
  const day = localDay(plannedFor)
  if (!day) return plannedFor
  if (isSameDay(day, now)) return 'Today'
  if (isSameDay(day, addDays(now, 1))) return 'Tomorrow'
  if (isSameDay(day, addDays(now, -1))) return 'Yesterday'
  return format(day, isSameYear(day, now) ? 'EEE d MMM' : 'EEE d MMM yyyy')
}

export const isOverdue = (plannedFor: string | null, now: Date): boolean => {
  const day = plannedFor === null ? undefined : localDay(plannedFor)
  return day !== undefined && isBefore(day, startOfDay(now))
}

export const planSummary = (plan: Pick<StrengthPlan, 'sets'>): string =>
  sessionSummary(blocksFromSets(plan.sets, () => ''))

export const splitPlans = <T extends Pick<StrengthPlan, 'planned_for'>>(
  plans: T[],
): { dated: T[]; saved: T[] } => ({
  dated: plans.filter((p) => p.planned_for !== null),
  saved: plans.filter((p) => p.planned_for === null),
})

export const isPlannedToday = (plannedFor: string | null, now: Date): boolean => {
  const day = plannedFor === null ? undefined : localDay(plannedFor)
  return day !== undefined && isSameDay(day, now)
}

export const plansForToday = <T extends Pick<StrengthPlan, 'planned_for'>>(plans: T[], now: Date): T[] =>
  plans.filter((p) => isPlannedToday(p.planned_for, now))

export const isPrimaryStart = (plannedFor: string | null, now: Date): boolean =>
  isPlannedToday(plannedFor, now) || isOverdue(plannedFor, now)

export const lastDoneLabel = (sessions: StrengthPlan['sessions'], now: Date): string => {
  const newest = sessions
    .map((s) => new Date(s.start_time))
    .filter((d) => !Number.isNaN(d.getTime()))
    .reduce<Date | undefined>((latest, d) => (latest && latest >= d ? latest : d), undefined)
  if (!newest) return 'Not done yet'
  return `Last done ${format(newest, isSameYear(newest, now) ? 'EEE d MMM' : 'EEE d MMM yyyy')}`
}

/** The saved workout (a plan without a day) a session was started from, while it is still open. */
export const savedAsPlan = <T extends Pick<StrengthPlan, 'id' | 'planned_for'>>(
  planId: string | undefined,
  plans: T[],
): T | undefined =>
  planId === undefined ? undefined : plans.find((p) => p.planned_for === null && p.id === planId)

const HOUR_MS = 3_600_000

const muscleGroupName = (group: ExerciseMuscleGroup): string => exerciseMuscleInfo[group].name

const listOf = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

const capitalised = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1)

const hoursUntil = (readyAt: string | null, now: Date): number => {
  if (readyAt === null) return 0
  const hours = (new Date(readyAt).getTime() - now.getTime()) / HOUR_MS
  return hours > 0 ? Math.max(1, Math.round(hours)) : 0
}

export const readinessLine = (
  muscleGroups: readonly ExerciseMuscleGroup[],
  recovery: MuscleRecovery | null | undefined,
  now: Date,
): string | undefined => {
  if (muscleGroups.length === 0 || !recovery) return undefined
  const groups = muscleGroups.flatMap((group) => {
    const r = recovery.groups.find((g) => g.muscle_group === group)
    if (!r) return []
    const ready = recoveryLevel(r.recovery, recovery.ready_percent) === 'ready'
    return [{ group, hours: ready ? 0 : hoursUntil(r.ready_at, now), ready }]
  })
  if (groups.length === 0) return undefined
  const recovering = groups.filter((g) => !g.ready)
  if (recovering.length === 0) {
    const names = groups.map((g) => muscleGroupName(g.group).toLowerCase())
    return `${capitalised(listOf(names))} ${names.length === 1 ? 'is' : 'are'} ready`
  }
  return `Still recovering: ${recovering
    .toSorted((a, b) => b.hours - a.hours)
    .map((g) => `${muscleGroupName(g.group).toLowerCase()} (${g.hours} h)`)
    .join(', ')}`
}

export const planFormError = (name: string, blocks: ExerciseBlock[]): string | undefined => {
  if (name.trim() === '') return 'Give the plan a name.'
  if (loggedSetCount(blocks) === 0) return 'Add at least one set.'
  return undefined
}

export interface PlanFields {
  name: string
  day: string
  note: string
}

export const planBody = (fields: PlanFields, blocks: ExerciseBlock[]): CreateStrengthPlanBody => ({
  name: fields.name.trim(),
  note: text(fields.note) ?? null,
  planned_for: fields.day.trim() === '' ? null : fields.day.trim(),
  sets: planSetsFromBlocks(blocks),
})
