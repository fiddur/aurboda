import type { ActivityItemGroup, ActivityItemHistory, StrengthScore } from '@aurboda/api-spec'

import { isSameName } from '../../components/knownValueSuggestions'
import { formatMeasure } from '../../utils/measures'
import { recordLines } from './records'
import {
  blocksFromSets,
  blockSummary,
  exerciseNames,
  type ExerciseBlock,
  setsOfData,
  setsOfExercise,
  type SetRow,
} from './sessionModel'

export interface SummaryInput {
  activity: { start_time: Date; end_time?: Date; data?: Record<string, unknown> | null }
  history?: ActivityItemHistory
  scoreBefore?: StrengthScore | null
  scoreAfter?: StrengthScore | null
  activeCalories?: number
}

export interface SummaryStat {
  label: string
  value: string
}

export interface SummaryExercise {
  name: string
  summary: string
  records: string[]
}

export interface SessionSummaryView {
  headline: string
  highlights: string[]
  stats: SummaryStat[]
  exercises: SummaryExercise[]
}

interface ScoreMove {
  name: string
  before: number | null
  after: number
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const isWarmup = (set: SetRow): boolean => String(set.set_type).trim().toLowerCase() === 'warmup'

const scoreMoves = (before: StrengthScore | null | undefined, after: StrengthScore | null | undefined) => {
  if (!before || !after || before.missing.length > 0 || after.missing.length > 0) return []
  const moves: ScoreMove[] = []
  if (after.score !== null) moves.push({ after: after.score, before: before.score, name: 'strength' })
  for (const g of after.groups) {
    if (g.score === null) continue
    const was = before.groups.find((b) => b.group === g.group)?.score ?? null
    moves.push({ after: g.score, before: was, name: g.name })
  }
  return moves.filter((m) => m.before === null || m.after > m.before)
}

const capitalised = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1)

const moveLine = (m: ScoreMove): string => {
  const label = m.name === 'strength' ? 'Strength score' : capitalised(m.name)
  if (m.before === null) return `First ${m.name.toLowerCase()} score: ${m.after}`
  return `${label} ${m.before} → ${m.after} (+${m.after - m.before})`
}

const scoreHeadline = (moves: ScoreMove[]): string | undefined => {
  const risen = moves
    .filter((m): m is ScoreMove & { before: number } => m.before !== null)
    .toSorted((a, b) => Number(b.name === 'strength') - Number(a.name === 'strength'))
  const best = risen[0]
  if (best) {
    return `Stronger: ${best.name.toLowerCase()} score up ${plural(best.after - best.before, 'point', 'points')}`
  }
  const first = moves[0]
  return first ? moveLine(first) : undefined
}

const groupOf = (history: ActivityItemHistory | undefined, exercise: string): ActivityItemGroup | undefined =>
  history?.groups.find((g) => isSameName(g.value, exercise))

const exerciseRecords = (
  blocks: ExerciseBlock[],
  history: ActivityItemHistory | undefined,
): SummaryExercise[] => {
  const seen: string[] = []
  return blocks.map((block) => {
    const first = !seen.some((n) => isSameName(n, block.exercise))
    seen.push(block.exercise)
    const group = first ? groupOf(history, block.exercise) : undefined
    const lines =
      group?.previous && group.records.length > 0
        ? recordLines(group.records, group.measures, setsOfExercise(blocks, block.exercise))
        : undefined
    return {
      name: block.exercise,
      records: lines ? [...lines.session, ...[...lines.bySet.values()].flat()] : [],
      summary: blockSummary(block),
    }
  })
}

const sessionStats = (sets: SetRow[], minutes: number, activeCalories: number | undefined): SummaryStat[] => {
  const working = sets.filter((s) => !isWarmup(s))
  const warmups = sets.length - working.length
  const volume = working.reduce((sum, s) => sum + num(s.weight) * num(s.reps), 0)
  const reps = working.reduce((sum, s) => sum + num(s.reps), 0)
  return [
    { label: 'Duration', value: `${minutes} min` },
    { label: 'Exercises', value: String(exerciseNames(sets).length) },
    { label: warmups > 0 ? `Sets (+${warmups} warmup)` : 'Sets', value: String(working.length) },
    ...(volume > 0
      ? [{ label: 'Volume', value: formatMeasure('volume', volume) }]
      : reps > 0
        ? [{ label: 'Total reps', value: String(reps) }]
        : []),
    ...(activeCalories !== undefined && Math.round(activeCalories) > 0
      ? [{ label: 'Active calories', value: `${Math.round(activeCalories)} kcal` }]
      : []),
  ]
}

export const sessionMinutes = (start: Date, end: Date | undefined): number =>
  end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)) : 0

export const sessionSummaryView = ({
  activity,
  history,
  scoreBefore,
  scoreAfter,
  activeCalories,
}: SummaryInput): SessionSummaryView => {
  const sets = setsOfData(activity.data)
  const minutes = sessionMinutes(activity.start_time, activity.end_time)
  const exercises = exerciseRecords(blocksFromSets(sets), history)
  const recordCount = exercises.reduce((n, e) => n + e.records.length, 0)
  const recordsLine = recordCount > 0 ? plural(recordCount, 'new record', 'new records') : undefined
  const moves = scoreMoves(scoreBefore, scoreAfter)
  const headline =
    scoreHeadline(moves) ??
    recordsLine ??
    `Session done: ${plural(minutes, 'minute', 'minutes')} of movement added`
  const highlights = [...moves.map(moveLine), ...(recordsLine ? [recordsLine] : [])].filter(
    (l) => l !== headline,
  )
  return { exercises, headline, highlights, stats: sessionStats(sets, minutes, activeCalories) }
}
