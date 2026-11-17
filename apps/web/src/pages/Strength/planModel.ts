import {
  type CreateStrengthPlanBody,
  type StrengthPlan,
  type StrengthPlanSet,
  strengthPlanSetTypes,
} from '@aurboda/api-spec'
import { addDays, format, isBefore, isSameDay, isSameYear, startOfDay } from 'date-fns'

import {
  blocksFromSets,
  type ExerciseBlock,
  loggedSetCount,
  makeBlockId,
  type MakeId,
  prefillOf,
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
  blocksFromPlan(sets, makeId).map((b) => ({ ...b, planned: b.sets.map(prefillOf), sets: [] }))

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
): { dated: T[]; routines: T[] } => ({
  dated: plans.filter((p) => p.planned_for !== null),
  routines: plans.filter((p) => p.planned_for === null),
})

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
