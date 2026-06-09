/**
 * Top-level exploratory correlation services that wire selector resolution to
 * the event-outcome and continuous engines. These are the functions the REST
 * routes and MCP tools call.
 */

import type { SyncProvider } from '../queries/index.ts'
import type { ContinuousResult } from './continuous.ts'
import type { Selector } from './selectors.ts'
import type { EventOutcomeConfig, EventOutcomeBlock, TriggerCondition } from './types.ts'

import { triggerCorrelationSyncs } from './background-sync.ts'
import { computeContinuous } from './continuous.ts'
import { compoundTriggerDays, computeEventOutcome } from './event-outcome.ts'
import { resolveSelector } from './selectors.ts'

/**
 * Resolve the analysis window from an explicit regime or a trailing N days.
 * All boundaries are UTC so they align with the engine's UTC day-bucketing
 * regardless of the server timezone.
 */
const resolveWindow = (params: {
  periodStart?: string
  periodEnd?: string
  periodDays?: number
}): { start: Date; end: Date } => {
  const endDay = params.periodEnd ?? new Date().toISOString().split('T')[0]
  const end = new Date(`${endDay}T23:59:59.999Z`)
  const start = params.periodStart
    ? new Date(`${params.periodStart}T00:00:00.000Z`)
    : new Date(Date.parse(`${endDay}T00:00:00.000Z`) - (params.periodDays ?? 90) * MS_PER_DAY)
  return { start, end }
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
  // Fire-and-forget: never block the analysis on live external syncs.
  triggerCorrelationSyncs(sync, user)

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
