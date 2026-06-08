/**
 * Top-level exploratory correlation services that wire selector resolution to
 * the event-outcome and continuous engines. These are the functions the REST
 * routes and MCP tools call.
 */

import type { SyncProvider } from '../queries/index.ts'
import type { ContinuousResult } from './continuous.ts'
import type { EventOutcomeResult } from './event-outcome.ts'
import type { Selector } from './selectors.ts'
import type { EventOutcomeConfig, EventOutcomeBlock, TriggerCondition } from './types.ts'

import { computeContinuous } from './continuous.ts'
import { compoundTriggerDays, computeEventOutcome } from './event-outcome.ts'
import { resolveSelector } from './selectors.ts'

/** Resolve the analysis window from an explicit regime or a trailing N days. */
const resolveWindow = (params: {
  periodStart?: string
  periodEnd?: string
  periodDays?: number
}): { start: Date; end: Date } => {
  const end = params.periodEnd
    ? new Date(`${params.periodEnd}T23:59:59.999Z`)
    : (() => {
        const d = new Date()
        d.setHours(23, 59, 59, 999)
        return d
      })()
  const start = params.periodStart
    ? new Date(`${params.periodStart}T00:00:00.000Z`)
    : (() => {
        const d = new Date(end)
        d.setDate(d.getDate() - (params.periodDays ?? 90))
        d.setHours(0, 0, 0, 0)
        return d
      })()
  return { start, end }
}

const triggerSyncs = (sync: SyncProvider, user: string): Promise<unknown>[] => [
  sync.syncOuraIfNeeded(user, 'tags'),
  sync.syncOuraIfNeeded(user, 'sessions'),
  sync.syncRescueTimeIfNeeded(user),
  sync.syncCalendarsIfNeeded(user),
]

export interface EventOutcomeParams {
  trigger: Selector
  outcome: Selector
  lagWindows?: string[]
  periodStart?: string
  periodEnd?: string
  periodDays?: number
  /** Consecutive outcome days within this gap collapse into one onset (default 3). */
  collapseGapDays?: number
  /** Denominator universe: known-status days only, or every day in range. */
  denominator?: 'known' | 'all'
}

export interface EventOutcomeCorrelation extends EventOutcomeResult {
  trigger: Selector
  outcome: Selector
  period: { start: string; end: string; days: number }
  collapse_gap_days: number
  denominator: 'known' | 'all'
}

/**
 * Event-outcome correlation with onset-collapsing and exposure correction
 * (issue #792). The trigger selector supplies event days; the outcome selector
 * supplies outcome days and the known-day denominator.
 */
export const getEventOutcomeCorrelation = async (
  user: string,
  params: EventOutcomeParams,
  sync?: SyncProvider,
): Promise<EventOutcomeCorrelation> => {
  if (sync) await Promise.all(triggerSyncs(sync, user))

  const { start, end } = resolveWindow(params)
  const lagWindows = params.lagWindows ?? ['24h', '48h', '7d']
  const collapseGapDays = params.collapseGapDays ?? 3
  const denominator = params.denominator ?? 'known'

  const [triggerSeries, outcomeSeries] = await Promise.all([
    resolveSelector(user, params.trigger, start, end),
    resolveSelector(user, params.outcome, start, end),
  ])

  // With the 'all' denominator, every day in the window is a candidate (used
  // when the outcome is reliably logged across the whole period).
  const knownDays = denominator === 'all' ? enumerateDays(start, end) : outcomeSeries.knownDays

  const result = computeEventOutcome({
    triggerDays: triggerSeries.eventDays,
    outcomeDays: outcomeSeries.eventDays,
    knownDays,
    lagWindows,
    collapseGapDays,
  })

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000)
  return {
    ...result,
    trigger: params.trigger,
    outcome: params.outcome,
    period: { start: start.toISOString(), end: end.toISOString(), days },
    collapse_gap_days: collapseGapDays,
    denominator,
  }
}

export interface ContinuousParams {
  trigger: Selector
  outcome: Selector
  /** Days the outcome lags the trigger (default 0). */
  lagDays?: number
  periodStart?: string
  periodEnd?: string
  periodDays?: number
}

export interface ContinuousCorrelation extends ContinuousResult {
  trigger: Selector
  outcome: Selector
  period: { start: string; end: string; days: number }
}

/**
 * Continuous daily correlation between two selectors (e.g. carb intake vs sleep
 * score), with an optional day-lag shift.
 */
export const getContinuousCorrelation = async (
  user: string,
  params: ContinuousParams,
  sync?: SyncProvider,
): Promise<ContinuousCorrelation> => {
  if (sync) await Promise.all(triggerSyncs(sync, user))

  const { start, end } = resolveWindow(params)
  const lagDays = params.lagDays ?? 0

  const [triggerSeries, outcomeSeries] = await Promise.all([
    resolveSelector(user, params.trigger, start, end),
    resolveSelector(user, params.outcome, start, end),
  ])

  const result = computeContinuous({
    triggerDaily: triggerSeries.daily,
    outcomeDaily: outcomeSeries.daily,
    triggerKnown: triggerSeries.knownDays,
    outcomeKnown: outcomeSeries.knownDays,
    lagDays,
  })

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000)
  return {
    ...result,
    trigger: params.trigger,
    outcome: params.outcome,
    period: { start: start.toISOString(), end: end.toISOString(), days },
  }
}

/** Map a trigger condition to a resolvable selector. */
const triggerConditionToSelector = (cond: TriggerCondition): Selector => {
  switch (cond.type) {
    case 'nutrition':
      return { kind: 'nutrition', nutrient: cond.nutrient!, threshold: cond.threshold }
    case 'activity':
      return { kind: 'activity', pattern: cond.pattern ?? '' }
    case 'productivity_category':
      return { kind: 'productivity_category', pattern: cond.pattern ?? '' }
    case 'productivity_app':
      return { kind: 'productivity_app', pattern: cond.pattern ?? '' }
    case 'tag':
    default:
      return { kind: 'tag', pattern: cond.pattern ?? '' }
  }
}

/** Map an event outcome config to the selector that supplies its onset events. */
const eventOutcomeToSelector = (outcome: EventOutcomeConfig): Selector =>
  outcome.source === 'metric'
    ? { kind: 'metric', metric: outcome.metric ?? '', threshold: outcome.threshold }
    : { kind: 'tag', pattern: outcome.pattern ?? '' }

export interface CompoundEventOutcomeResult extends EventOutcomeBlock {
  period: { start: string; end: string; days: number }
}

/**
 * Event-outcome correlation driven by the generic-correlation trigger model: a
 * trigger day is one where ALL trigger conditions are satisfied (AND logic,
 * honouring min_count / window_days). Used by get_generic_correlation when the
 * outcome is an `event`.
 */
export const getCompoundEventOutcome = async (
  user: string,
  triggers: TriggerCondition[],
  outcome: EventOutcomeConfig,
  lagWindows: string[],
  options: { periodStart?: string; periodEnd?: string; periodDays?: number; denominator?: 'known' | 'all' },
): Promise<CompoundEventOutcomeResult> => {
  const { start, end } = resolveWindow(options)
  const collapseGapDays = outcome.collapse_gap_days ?? 3
  const denominator = options.denominator ?? 'known'
  const candidateDays = enumerateDays(start, end)

  const [conditionSeries, outcomeSeries] = await Promise.all([
    Promise.all(triggers.map((t) => resolveSelector(user, triggerConditionToSelector(t), start, end))),
    resolveSelector(user, eventOutcomeToSelector(outcome), start, end),
  ])

  const triggerDays = compoundTriggerDays(
    triggers.map((t, i) => ({
      eventDays: conditionSeries[i].eventDays,
      minCount: t.min_count ?? 1,
      windowDays: t.window_days ?? 1,
    })),
    candidateDays,
  )

  const knownDays = denominator === 'all' ? candidateDays : outcomeSeries.knownDays

  const result = computeEventOutcome({
    triggerDays,
    outcomeDays: outcomeSeries.eventDays,
    knownDays,
    lagWindows,
    collapseGapDays,
  })

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000)
  return {
    denominator,
    collapse_gap_days: collapseGapDays,
    trigger_days: result.trigger_days,
    outcome_days: result.outcome_days,
    onsets: result.onsets,
    known_days: result.known_days,
    per_lag: result.per_lag,
    period: { start: start.toISOString(), end: end.toISOString(), days },
  }
}

const MS_PER_DAY = 86_400_000

/** All UTC days in the inclusive [start, end] range. */
const enumerateDays = (start: Date, end: Date): string[] => {
  const days: string[] = []
  let cur = Date.parse(`${start.toISOString().split('T')[0]}T00:00:00Z`)
  const last = Date.parse(`${end.toISOString().split('T')[0]}T00:00:00Z`)
  while (cur <= last) {
    days.push(new Date(cur).toISOString().split('T')[0])
    cur += MS_PER_DAY
  }
  return days
}
