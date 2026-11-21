import {
  type ExerciseMuscleGroup,
  type StrengthScore,
  STRENGTH_SCORE_MAX_REPS,
  type StrengthScoreGroup,
  type StrengthScoreGroupResult,
  strengthScoreGroups,
  type StrengthScoreHistory,
  type StrengthScoreLift,
  type StrengthScoreMissing,
  type StrengthScoreSet,
} from '@aurboda/api-spec'
import { differenceInCalendarDays, endOfDay, startOfDay, subDays } from 'date-fns'

import { formatDay } from '../../components/RecordCard'
import { formatMeasure } from '../../utils/measures'

const DAY_MS = 86_400_000
const EXPIRING_DAYS = 14

export const STRENGTH_SCORE_PERIODS = [
  { label: '1 year', value: 365 },
  { label: '90 days', value: 90 },
  { label: '3 years', value: 1095 },
]

export interface StrengthScorePeriod {
  end: string
  start: string
  step_days: number
}

const stepDays = (days: number): number => {
  if (days <= 90) return 1
  return days <= 365 ? 7 : 14
}

export const strengthScorePeriod = (days: number, now: Date): StrengthScorePeriod => ({
  end: endOfDay(now).toISOString(),
  start: startOfDay(subDays(now, days)).toISOString(),
  step_days: stepDays(days),
})

export type ScoreSeriesKey = StrengthScoreGroup | 'overall'

const pointValue = (point: StrengthScoreHistory['points'][number], key: ScoreSeriesKey) =>
  key === 'overall' ? point.score : point.groups[key]

export const scoreSeries = (
  history: StrengthScoreHistory | null | undefined,
  key: ScoreSeriesKey,
): { date: string; value: number }[] =>
  (history?.points ?? []).flatMap((p) => {
    const value = pointValue(p, key)
    return value === null || value === undefined ? [] : [{ date: p.at, value }]
  })

/** The last point's overall score against that of the latest point at least `days` before it. */
export const scoreChange = (
  history: StrengthScoreHistory | null | undefined,
  days: number,
): number | undefined => {
  const points = history?.points ?? []
  const last = points.at(-1)
  if (!last || last.score === null) return undefined
  const cutoff = new Date(last.at).getTime() - days * DAY_MS
  const before = points.findLast((p) => new Date(p.at).getTime() <= cutoff)
  if (!before || before.score === null) return undefined
  return last.score - before.score
}

export const changeLabel = (change: number): string => {
  if (change > 0) return `+${change}`
  return change < 0 ? `-${Math.abs(change)}` : '±0'
}

export const groupsWithHistory = (history: StrengthScoreHistory | null | undefined): StrengthScoreGroup[] =>
  strengthScoreGroups.filter(
    (g) => (history?.points ?? []).filter((p) => p.groups[g] !== undefined).length >= 2,
  )

export type LiftNote = 'counted' | 'expiring' | 'not_counted'

const daysLeft = (lift: StrengthScoreLift, now: Date): number | undefined =>
  lift.expires_at === undefined
    ? undefined
    : Math.max(differenceInCalendarDays(new Date(lift.expires_at), now), 0)

export const liftNote = (lift: StrengthScoreLift, now: Date): LiftNote | undefined => {
  if (lift.score === null) return undefined
  if (!lift.counted) return 'not_counted'
  const left = daysLeft(lift, now)
  return left !== undefined && left <= EXPIRING_DAYS ? 'expiring' : 'counted'
}

const leavesIn = (days: number): string => {
  if (days === 0) return 'today'
  return days === 1 ? 'tomorrow' : `in ${days} days`
}

export const liftNoteLabel = (lift: StrengthScoreLift, now: Date): string | undefined => {
  switch (liftNote(lift, now)) {
    case 'counted':
      return 'Counts'
    case 'not_counted':
      return 'Not among the best three'
    case 'expiring':
      return `Leaves the 90 days ${leavesIn(daysLeft(lift, now) ?? 0)}`
    case undefined:
      return undefined
  }
}

const kg = (value: number): string => formatMeasure('max_weight', value)

export const bestSetLabel = (best: StrengthScoreSet): string => `${kg(best.weight)} × ${best.reps}`

/** The second line of a lift's row, split so the day can be a link: `{set} on {day}{rest}`. */
export const liftDetailParts = (best: StrengthScoreSet): { day: string; rest: string; set: string } => ({
  day: formatDay(best.start_time),
  rest: [
    '',
    best.reps > STRENGTH_SCORE_MAX_REPS
      ? `est. 1RM ${kg(best.e1rm)} (as ${STRENGTH_SCORE_MAX_REPS} reps)`
      : `est. 1RM ${kg(best.e1rm)}`,
    ...(best.reference_e1rm === undefined ? [] : [`100 points at ${kg(best.reference_e1rm)}`]),
  ].join(' · '),
  set: bestSetLabel(best),
})

export const liftDetail = (best: StrengthScoreSet): string => {
  const { day, rest, set } = liftDetailParts(best)
  return `${set} on ${day}${rest}`
}

export interface MissingAction {
  after: string
  before: string
  href: string
  link: string
}

const MISSING_NAMES: Record<StrengthScoreMissing, string> = { bodyweight: 'your bodyweight', sex: 'your sex' }

const MISSING_ACTIONS: Record<StrengthScoreMissing, MissingAction> = {
  bodyweight: { after: '.', before: 'Add your weight under ', href: '/add', link: 'Add data' },
  sex: { after: '.', before: 'Set your sex in ', href: '/settings', link: 'Settings' },
}

const MISSING_ORDER: StrengthScoreMissing[] = ['sex', 'bodyweight']

export const missingText = (
  missing: StrengthScoreMissing[],
): { actions: MissingAction[]; sentence: string } | undefined => {
  const present = MISSING_ORDER.filter((m) => missing.includes(m))
  if (present.length === 0) return undefined
  const names = present.map((m) => MISSING_NAMES[m]).join(' and ')
  const object = present.length > 1 ? 'both' : 'it'
  return {
    actions: present.map((m) => MISSING_ACTIONS[m]),
    sentence: `A score needs ${names}: what counts as 100 points for a lift depends on ${object}.`,
  }
}

export const scoreGroupOf = (
  muscleGroup: ExerciseMuscleGroup,
  score: StrengthScore | null | undefined,
): StrengthScoreGroupResult | undefined => score?.groups.find((g) => g.muscle_groups.includes(muscleGroup))

export const scoredGroupCount = (score: StrengthScore): number =>
  score.groups.filter((g) => g.score !== null).length

export const averageLabel = (score: StrengthScore): string => {
  const n = scoredGroupCount(score)
  return `average of ${n} muscle ${n === 1 ? 'group' : 'groups'}`
}

/** The scored groups, strongest first: `Chest 112 · Back 98`. */
export const groupScoresLine = (score: StrengthScore): string =>
  score.groups
    .flatMap((g) => (g.score === null ? [] : [{ name: g.name, score: g.score }]))
    .toSorted((a, b) => b.score - a.score)
    .map((g) => `${g.name} ${g.score}`)
    .join(' · ')

export const pointsLabel = (points: number | null): string => (points === null ? '–' : String(points))

export interface ScoredGroup {
  group: StrengthScoreGroup
  name: string
  score: number
}

/** The highest and lowest scored groups, ties going to the first in `score.groups` order. */
export const strongestAndWeakest = (
  score: StrengthScore,
): { strongest: ScoredGroup; weakest: ScoredGroup } | undefined => {
  const scored = score.groups.flatMap((g) =>
    g.score === null ? [] : [{ group: g.group, name: g.name, score: g.score }],
  )
  const [first, ...rest] = scored
  if (!first) return undefined
  const strongest = rest.reduce((best, g) => (g.score > best.score ? g : best), first)
  const weakest = rest.reduce((low, g) => (g.score < low.score ? g : low), first)
  return strongest.group === weakest.group ? undefined : { strongest, weakest }
}

export const strongestAndWeakestLabel = ({
  strongest,
  weakest,
}: {
  strongest: ScoredGroup
  weakest: ScoredGroup
}): string => `${strongest.name} ${strongest.score} · ${weakest.name} ${weakest.score}`
