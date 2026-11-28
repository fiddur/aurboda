import {
  type ChartDataBreakdownBucket,
  type ExerciseMuscleGroup,
  exerciseMuscleGroupPlural,
  exerciseMuscleInfo,
  type MuscleGroupOverview,
  type MuscleRecovery,
  type MuscleRecoveryGroup,
  type MuscleRecoverySource,
  type StrengthScore,
  type StrengthScoreGroupResult,
  type StrengthScoreHistory,
  UNMAPPED_MUSCLE_GROUP_NAME,
} from '@aurboda/api-spec'
import { differenceInCalendarDays, endOfDay, format, startOfDay, subDays } from 'date-fns'

import { readyLabel, tiredGroups } from '../../components/muscleRecovery/recoveryView'
import { formatSetCount } from '../../utils/measures'
import {
  changeLabel,
  scoreChange,
  scoreGroupOf,
  strongestAndWeakest,
} from '../StrengthScore/strengthScoreView'

export const SET_WINDOWS = 13
const WINDOW_DAYS = 7
export const SET_DAYS = SET_WINDOWS * WINDOW_DAYS
export const SCORE_CHANGE_DAYS = 30
export const NEGLECTED_DAYS = 30
const MAX_NAMES = 4
const HOUR_MS = 3_600_000
const HOURS_SHOWN_BELOW = 48
const MIN_BAR_SCALE = 5

export const BODY_REGIONS: { groups: ExerciseMuscleGroup[]; name: string }[] = [
  { groups: ['chest', 'shoulders', 'traps', 'neck'], name: 'Chest and shoulders' },
  { groups: ['lats', 'middle_back', 'lower_back'], name: 'Back' },
  { groups: ['biceps', 'triceps', 'forearms'], name: 'Arms' },
  { groups: ['abdominals'], name: 'Core' },
  { groups: ['glutes', 'quadriceps', 'hamstrings', 'adductors', 'abductors', 'calves'], name: 'Legs' },
]

export const NEVER_TRAINED_HEADING = 'Never trained'

const BODY_ORDER: ExerciseMuscleGroup[] = BODY_REGIONS.flatMap((r) => r.groups)

export const setsPeriod = (now: Date): { end: string; start: string } => ({
  end: endOfDay(now).toISOString(),
  start: startOfDay(subDays(now, SET_DAYS - 1)).toISOString(),
})

export const setWindows = (buckets: ChartDataBreakdownBucket[], now: Date): Map<string, number[]> => {
  const windows = new Map<string, number[]>()
  for (const bucket of buckets) {
    const daysAgo = differenceInCalendarDays(now, new Date(bucket.bucket_start))
    if (daysAgo < 0 || daysAgo >= SET_DAYS) continue
    const index = SET_WINDOWS - 1 - Math.floor(daysAgo / WINDOW_DAYS)
    for (const [name, value] of Object.entries(bucket.series)) {
      const series = windows.get(name) ?? Array.from({ length: SET_WINDOWS }, () => 0)
      windows.set(name, series)
      series[index] += value
    }
  }
  return windows
}

export const unmatchedSets = (windows: Map<string, number[]>): number =>
  (windows.get(UNMAPPED_MUSCLE_GROUP_NAME) ?? []).reduce((sum, v) => sum + v, 0)

export const anySets = (windows: Map<string, number[]>): boolean =>
  [...windows.values()].some((series) => series.some((v) => v > 0))

export const noStrengthSessions = (groups: MuscleGroupOverview, windows: Map<string, number[]>): boolean =>
  !anySets(windows) && groups.groups.every((g) => g.last_trained === null)

export interface MuscleRow {
  avg: number
  last_trained: string | null
  muscle_group: ExerciseMuscleGroup
  name: string
  never_trained: boolean
  recovery?: MuscleRecoveryGroup
  score_change?: number
  score_group?: StrengthScoreGroupResult
  sets7: number
  windows: number[]
}

export const muscleRows = ({
  groups,
  history,
  recovery,
  score,
  windows,
}: {
  groups: MuscleGroupOverview
  history?: StrengthScoreHistory | null
  recovery?: MuscleRecovery | null
  score?: StrengthScore | null
  windows: Map<string, number[]>
}): MuscleRow[] => {
  const lastTrained = new Map(groups.groups.map((g) => [g.muscle_group, g.last_trained]))
  return BODY_ORDER.map((group) => {
    const name = exerciseMuscleInfo[group].name
    const series = windows.get(name) ?? Array.from({ length: SET_WINDOWS }, () => 0)
    const total = series.reduce((sum, v) => sum + v, 0)
    const last = lastTrained.get(group) ?? null
    const scoreGroup = scoreGroupOf(group, score)
    return {
      avg: total / SET_WINDOWS,
      last_trained: last,
      muscle_group: group,
      name,
      never_trained: last === null && total === 0,
      recovery: recovery?.groups.find((g) => g.muscle_group === group),
      score_change: scoreGroup ? scoreChange(history, SCORE_CHANGE_DAYS, scoreGroup.group) : undefined,
      score_group: scoreGroup,
      sets7: series.at(-1) ?? 0,
      windows: series,
    }
  })
}

export type MuscleSort = 'body' | 'recovery' | 'behind' | 'longest' | 'weakest'

export const MUSCLE_SORTS: { label: string; value: MuscleSort }[] = [
  { label: 'Body order', value: 'body' },
  { label: 'Least recovered', value: 'recovery' },
  { label: 'Behind on sets', value: 'behind' },
  { label: 'Longest since trained', value: 'longest' },
  { label: 'Weakest score', value: 'weakest' },
]

const missingLast =
  <T>(key: (row: MuscleRow) => T | undefined, compare: (a: T, b: T) => number) =>
  (a: MuscleRow, b: MuscleRow): number => {
    const ka = key(a)
    const kb = key(b)
    if (ka === undefined) return kb === undefined ? 0 : 1
    if (kb === undefined) return -1
    return compare(ka, kb)
  }

const byNumber = (a: number, b: number) => a - b

const SORTS: Record<Exclude<MuscleSort, 'body'>, (a: MuscleRow, b: MuscleRow) => number> = {
  behind: (a, b) => a.sets7 - a.avg - (b.sets7 - b.avg),
  longest: missingLast(
    (r) => (r.last_trained === null ? undefined : new Date(r.last_trained).getTime()),
    byNumber,
  ),
  recovery: missingLast((r) => r.recovery?.recovery, byNumber),
  weakest: missingLast((r) => r.score_group?.score ?? undefined, byNumber),
}

export interface MuscleSection {
  heading?: string
  rows: MuscleRow[]
}

export const muscleSections = (rows: MuscleRow[], sort: MuscleSort): MuscleSection[] => {
  if (sort !== 'body') return [{ rows: rows.toSorted(SORTS[sort]) }]
  const regions = BODY_REGIONS.map((region) => ({
    heading: region.name,
    rows: rows.filter((r) => !r.never_trained && region.groups.includes(r.muscle_group)),
  }))
  const never = { heading: NEVER_TRAINED_HEADING, rows: rows.filter((r) => r.never_trained) }
  return [...regions, never].filter((s) => s.rows.length > 0)
}

export const nameList = (names: string[], max = MAX_NAMES): string =>
  names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`

const daysSince = (iso: string, now: Date): number =>
  Math.max(differenceInCalendarDays(now, new Date(iso)), 0)

export const isNeglected = (lastTrained: string | null, now: Date): boolean =>
  lastTrained !== null && daysSince(lastTrained, now) >= NEGLECTED_DAYS

export const statusLine = (
  recovery: MuscleRecovery | null | undefined,
  groups: MuscleGroupOverview | undefined,
  now: Date,
): string | undefined => {
  const parts: string[] = []
  if (recovery) {
    const tired = tiredGroups(recovery, recovery.ready_percent)
    parts.push(
      tired.length === 0
        ? 'Every muscle is ready to train.'
        : `Recovering: ${nameList(tired.map((g) => g.name))}.`,
    )
  }
  const neglected = (groups?.groups ?? [])
    .flatMap((g) =>
      g.last_trained !== null && isNeglected(g.last_trained, now)
        ? [{ days: daysSince(g.last_trained, now), name: g.name }]
        : [],
    )
    .toSorted((a, b) => b.days - a.days)
  if (neglected.length > 0) {
    parts.push(`Not trained for a month: ${nameList(neglected.map((g) => `${g.name} (${g.days} days)`))}.`)
  }
  return parts.length > 0 ? parts.join(' ') : undefined
}

export const shortReadyLabel = (readyAt: string | null, now: Date): string | undefined => {
  if (readyAt === null) return undefined
  const ready = new Date(readyAt)
  const hours = (ready.getTime() - now.getTime()) / HOUR_MS
  if (hours <= 0) return undefined
  if (hours < HOURS_SHOWN_BELOW) return `${Math.max(1, Math.round(hours))} h`
  return format(ready, 'EEE')
}

export const isReady = (group: MuscleRecoveryGroup, readyPercent: number): boolean =>
  group.recovery >= readyPercent

export const newestSource = (group: MuscleRecoveryGroup): MuscleRecoverySource | undefined =>
  group.sources.toSorted((a, b) => new Date(b.end_time).getTime() - new Date(a.end_time).getTime())[0]

export const recoveryText = (group: MuscleRecoveryGroup, readyPercent: number, now: Date): string => {
  if (group.sources.length === 0 && isReady(group, readyPercent)) return 'Fully recovered, ready to train.'
  return isReady(group, readyPercent)
    ? `${group.recovery} % recovered, ready to train.`
    : `${group.recovery} % recovered. ${readyLabel(group.ready_at, now)}.`
}

const setsWord = (count: string): string => (count === '1' ? 'set' : 'sets')

export const setsText = (row: Pick<MuscleRow, 'avg' | 'sets7'>): string => {
  const sets = formatSetCount(row.sets7)
  return `${sets} ${setsWord(sets)} in the last 7 days · ${formatSetCount(row.avg)} a week on average over ${SET_WINDOWS} weeks`
}

export const windowHeights = (windows: number[]): number[] => {
  const scale = Math.max(MIN_BAR_SCALE, ...windows)
  return windows.map((v) => v / scale)
}

export const windowsLabel = (windows: number[]): string =>
  `Sets per week over ${SET_WINDOWS} weeks, oldest first: ${windows.map(formatSetCount).join(', ')}`

export const changeWords = (change: number): string => {
  if (change > 0) return `up ${change} in ${SCORE_CHANGE_DAYS} days`
  return change < 0 ? `down ${Math.abs(change)} in ${SCORE_CHANGE_DAYS} days` : 'unchanged'
}

export const scoreLine = (
  group: StrengthScoreGroupResult,
  change: number | undefined,
): string | undefined => {
  if (group.score === null) return undefined
  const base = `${group.name}: ${group.score} points`
  return change === undefined ? base : `${base}, ${changeWords(change)}`
}

const andList = (names: string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

export const scoredAsOneNote = (group: StrengthScoreGroupResult): string | undefined =>
  group.muscle_groups.length > 1
    ? `${group.name} is scored as one group: ${andList(group.muscle_groups.map((g) => exerciseMuscleInfo[g].name))}.`
    : undefined

export const notScoredLabel = (group: ExerciseMuscleGroup): string =>
  `${exerciseMuscleInfo[group].name} ${exerciseMuscleGroupPlural[group] ? 'aren’t' : 'isn’t'} scored`

export const SCORE_CHANGE_COLUMN = `±${SCORE_CHANGE_DAYS} d`

export const SCORE_CHANGE_TITLE = `Change in ${SCORE_CHANGE_DAYS} days`

export const unscoredText = (name: string): string =>
  `No lift is scored for ${name.toLowerCase()}, so it has no strength score.`

export const extremesLine = (score: StrengthScore): string | undefined => {
  const extremes = strongestAndWeakest(score)
  if (!extremes) return undefined
  const { strongest, weakest } = extremes
  return `Strongest ${strongest.name} ${strongest.score} · Weakest ${weakest.name} ${weakest.score}`
}

export const changeInDaysLabel = (change: number): string =>
  `${changeLabel(change)} in ${SCORE_CHANGE_DAYS} days`
