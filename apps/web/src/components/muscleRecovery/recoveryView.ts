import type {
  ExerciseMuscleGroup,
  MuscleRecovery,
  MuscleRecoveryGroup,
  MuscleRecoveryHistory,
  MuscleRecoverySource,
} from '@aurboda/api-spec'

import { addHours, differenceInCalendarDays, format, startOfHour, subDays } from 'date-fns'

import { formatSetCount } from '../../utils/measures'

const HOUR_MS = 3_600_000
const RECOVERING_FROM = 50
const PERIOD_DAYS = 14
const PERIOD_STEP_HOURS = 6

export type RecoveryLevel = 'ready' | 'recovering' | 'fatigued'

export const recoveryLevel = (recovery: number, readyPercent: number): RecoveryLevel => {
  if (recovery >= readyPercent) return 'ready'
  return recovery >= RECOVERING_FROM ? 'recovering' : 'fatigued'
}

export const readyLabel = (readyAt: string | null, now: Date): string => {
  if (readyAt === null) return 'Ready'
  const ready = new Date(readyAt)
  const hours = (ready.getTime() - now.getTime()) / HOUR_MS
  if (hours <= 0) return 'Ready'
  if (hours < 24) return `Ready in ${Math.max(1, Math.round(hours))} h`
  return differenceInCalendarDays(ready, now) === 1 ? 'Ready tomorrow' : `Ready on ${format(ready, 'EEE')}`
}

export const tiredGroups = (recovery: MuscleRecovery, below = 100): MuscleRecoveryGroup[] =>
  recovery.groups.filter((g) => g.recovery < below).toSorted((a, b) => a.recovery - b.recovery)

export const restCount = (recovery: MuscleRecovery, below = 100): number =>
  recovery.groups.filter((g) => g.recovery >= below).length

export const recoveryOf = (
  recovery: MuscleRecovery | null | undefined,
  muscleGroup: ExerciseMuscleGroup,
): MuscleRecoveryGroup | undefined => recovery?.groups.find((g) => g.muscle_group === muscleGroup)

export const filterOptionLabel = (name: string, recovery: number | undefined): string =>
  recovery === undefined || recovery >= 100 ? name : `${name} · ${recovery} %`

export interface RecoveryPeriod {
  end: string
  start: string
  step_hours: number
}

export const recoveryPeriod = (now: Date): RecoveryPeriod => {
  const end = addHours(startOfHour(now), 1)
  return {
    end: end.toISOString(),
    start: subDays(end, PERIOD_DAYS).toISOString(),
    step_hours: PERIOD_STEP_HOURS,
  }
}

export const recoverySeries = (
  history: MuscleRecoveryHistory | null | undefined,
  muscleGroup: ExerciseMuscleGroup,
): { date: string; value: number }[] =>
  (history?.points ?? []).flatMap((p) => {
    const value = p.recovery[muscleGroup]
    return value === undefined ? [] : [{ date: p.at, value }]
  })

export const restLine = (
  count: number,
  tired: number,
  state: 'ready' | 'recovered' = 'recovered',
): string | undefined => {
  if (tired === 0) return `All muscle groups are ${state}.`
  if (count === 0) return undefined
  return count === 1
    ? `The other muscle group is ${state}.`
    : `The other ${count} muscle groups are ${state}.`
}

export const sourceLabel = (source: MuscleRecoverySource): string => {
  const sets = formatSetCount(source.sets)
  return `${format(new Date(source.start_time), 'EEE d MMM')} · ${sets} ${sets === '1' ? 'set' : 'sets'}`
}
