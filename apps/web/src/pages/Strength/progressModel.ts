import type {
  StrengthScore,
  StrengthScoreGroup,
  StrengthScoreHistory,
  StrengthScoreLift,
  StrengthScoreSet,
} from '@aurboda/api-spec'

import { daysLeft, pointBefore } from '../StrengthScore/strengthScoreView'

const DAY_MS = 86_400_000
export const MOVED_DAYS = 30
export const LEAVING_DAYS = 30

export type MovedReason =
  | { kind: 'new_best'; lift: StrengthScoreLift & { best: StrengthScoreSet } }
  | { best_now?: StrengthScoreLift & { best: StrengthScoreSet }; kind: 'lift_left' }
  | { kind: 'all_left' }

export interface MovedRow {
  before?: number
  change?: number
  group: StrengthScoreGroup
  name: string
  now_score: number | null
  reason?: MovedReason
}

export interface Moved {
  no_score: string[]
  rows: MovedRow[]
  unchanged: string[]
}

type LiftWithBest = StrengthScoreLift & { best: StrengthScoreSet }

const countedWithBest = (lifts: StrengthScoreLift[]): LiftWithBest[] =>
  lifts.filter((l): l is LiftWithBest => l.counted && l.best !== undefined)

const highest = (lifts: LiftWithBest[]): LiftWithBest | undefined =>
  lifts.reduce<LiftWithBest | undefined>(
    (top, l) => (top === undefined || (l.score ?? -Infinity) > (top.score ?? -Infinity) ? l : top),
    undefined,
  )

const reasonFor = (
  lifts: StrengthScoreLift[],
  before: number | undefined,
  nowScore: number | null,
  now: Date,
): MovedReason | undefined => {
  if (nowScore === null) return { kind: 'all_left' }
  const counted = countedWithBest(lifts)
  if (before !== undefined && nowScore < before) {
    const best_now = highest(counted)
    return best_now ? { best_now, kind: 'lift_left' } : { kind: 'lift_left' }
  }
  const since = now.getTime() - MOVED_DAYS * DAY_MS
  const lift = highest(counted.filter((l) => new Date(l.best.start_time).getTime() >= since))
  return lift ? { kind: 'new_best', lift } : undefined
}

const rank = (row: MovedRow): number => (row.change === undefined ? Infinity : Math.abs(row.change))

/** The score groups whose score differs from the one 30 days before the history's last point. */
export const movedGroups = (
  score: StrengthScore,
  history: StrengthScoreHistory | null | undefined,
  now: Date,
): Moved => {
  const beforePoint = pointBefore(history, MOVED_DAYS)
  const moved: Moved = { no_score: [], rows: [], unchanged: [] }
  for (const g of score.groups) {
    const before = beforePoint?.groups[g.group]
    const nowScore = g.score
    if (nowScore === null && before === undefined) {
      moved.no_score.push(g.name)
    } else if (nowScore !== null && before !== undefined && nowScore === before) {
      moved.unchanged.push(g.name)
    } else {
      const reason = reasonFor(g.lifts, before, nowScore, now)
      moved.rows.push({
        ...(before === undefined ? {} : { before }),
        ...(nowScore !== null && before !== undefined ? { change: nowScore - before } : {}),
        group: g.group,
        name: g.name,
        now_score: nowScore,
        ...(reason ? { reason } : {}),
      })
    }
  }
  moved.rows = moved.rows.toSorted((a, b) => (rank(a) === rank(b) ? 0 : rank(b) - rank(a)))
  return moved
}

export interface LeavingLift {
  days: number
  expires_at: string
  groups: string[]
  lift: LiftWithBest
}

/** Counted lifts whose best set leaves the 90-day window within 30 days of `now`, soonest first. */
export const leavingSoon = (score: StrengthScore, now: Date): LeavingLift[] => {
  const limit = now.getTime() + LEAVING_DAYS * DAY_MS
  const byLift = new Map<string, LeavingLift>()
  for (const g of score.groups) {
    for (const lift of countedWithBest(g.lifts)) {
      const expires = lift.expires_at
      if (expires === undefined || new Date(expires).getTime() > limit) continue
      const known = byLift.get(lift.lift)
      if (known) {
        known.groups.push(g.name)
      } else {
        byLift.set(lift.lift, { days: daysLeft(lift, now) ?? 0, expires_at: expires, groups: [g.name], lift })
      }
    }
  }
  return [...byLift.values()].toSorted(
    (a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime(),
  )
}
