/**
 * Generic correlation analysis supporting compound triggers and multiple outcome types.
 */

import type { MetricType } from '@aurboda/api-spec'

import type { SyncProvider } from '../queries/index.ts'
import type {
  BaselineStats,
  GenericCorrelationOptions,
  GenericCorrelationResult,
  LagResult,
  OutcomeConfig,
  TagLagResult,
  TriggerCondition,
} from './types.ts'

import { getAllActivitiesInRange, getProductivity, getTimeSeries } from '../../db/index.ts'
import { getCompoundEventOutcome } from './explore.ts'
import { chiSquaredTest, mean, stddev } from './utils.ts'

/** Parse lag window string (e.g., "24h", "7d") to milliseconds */
const parseLagWindow = (lag: string): number | null => {
  const match = lag.match(/^(\d+)([hd])$/)
  if (!match) return null

  const value = parseInt(match[1], 10)
  const unit = match[2]
  return unit === 'h' ? value * 60 * 60 * 1000 : value * 24 * 60 * 60 * 1000
}

/** Get the day string (YYYY-MM-DD) for a date */
const getDayString = (date: Date): string => date.toISOString().split('T')[0]

/** Check if a string matches a pattern (case-insensitive) */
const matchesPattern = (value: string, pattern: string): boolean => {
  try {
    const regex = new RegExp(pattern, 'i')
    return regex.test(value)
  } catch {
    // Fall back to simple includes
    return value.toLowerCase().includes(pattern.toLowerCase())
  }
}

interface EventWithTime {
  time: Date
  type: 'activity' | 'tag' | 'productivity_category' | 'productivity_app'
  value: string
}

/**
 * Generic correlation analysis supporting compound triggers and multiple outcome types.
 *
 * This function allows correlating multiple trigger conditions (AND logic) with
 * various outcome types (tags, metrics, productivity time).
 *
 * Examples:
 * - "Does meditation correlate with more productive time?"
 * - "When I exercise 3x and tag FatCoffee 5x in a week, does my weight change?"
 */
// eslint-disable-next-line complexity -- TODO: refactor
export async function getGenericCorrelation(
  user: string,
  triggers: TriggerCondition[],
  outcome: OutcomeConfig,
  lagWindows: string[] = ['24h', '48h', '7d'],
  periodDays: number = 90,
  sync?: SyncProvider,
  options: GenericCorrelationOptions = {},
): Promise<GenericCorrelationResult> {
  // Event outcomes use the exposure-corrected onset engine instead of averaging.
  if (outcome.type === 'event') {
    return getGenericEventOutcome(user, triggers, outcome, lagWindows, periodDays, sync, options)
  }

  // Nutrition triggers are only resolvable through the event-outcome path; the
  // averaging path below has no nutrition case and would silently match nothing.
  if (triggers.some((t) => t.type === 'nutrition')) {
    throw new Error('Nutrition triggers are only supported with an "event" outcome')
  }

  // Window: an explicit regime (UTC) overrides the trailing periodDays window.
  // `analysisDays` is the number of days iterated/used as the day denominator.
  let start: Date
  let end: Date
  let analysisDays: number
  if (options.periodStart || options.periodEnd) {
    const endDay = options.periodEnd ?? new Date().toISOString().split('T')[0]
    end = new Date(`${endDay}T23:59:59.999Z`)
    start = options.periodStart
      ? new Date(`${options.periodStart}T00:00:00.000Z`)
      : new Date(Date.parse(`${endDay}T00:00:00.000Z`) - periodDays * 86_400_000)
    analysisDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000))
  } else {
    end = new Date()
    end.setHours(23, 59, 59, 999)
    start = new Date()
    start.setDate(start.getDate() - periodDays)
    start.setHours(0, 0, 0, 0)
    analysisDays = periodDays
  }

  // Auto-sync if provider available
  if (sync) {
    await Promise.all([
      sync.syncOuraIfNeeded(user, 'tags'),
      sync.syncOuraIfNeeded(user, 'sessions'),
      sync.syncRescueTimeIfNeeded(user),
      sync.syncCalendarsIfNeeded(user),
    ])
  }

  // Determine which data we need based on triggers and outcome
  const needsActivities =
    triggers.some((t) => t.type === 'activity' || t.type === 'tag') || outcome.type === 'tag'
  const needsProductivity =
    triggers.some((t) => t.type === 'productivity_category' || t.type === 'productivity_app') ||
    outcome.type === 'productivity'
  const needsMetrics = outcome.type === 'metric'

  // Fetch data in parallel
  const [activities, productivity, metricData] = await Promise.all([
    needsActivities ? getAllActivitiesInRange(user, start, end) : Promise.resolve([]),
    needsProductivity ? getProductivity(user, start, end) : Promise.resolve([]),
    needsMetrics && outcome.type === 'metric'
      ? getTimeSeries(user, outcome.metric as MetricType, start, end)
      : Promise.resolve([] as [Date, number][]),
  ])

  // Build a list of all trigger events with timestamps
  const triggerEvents: EventWithTime[] = []

  for (const trigger of triggers) {
    if (trigger.type === 'activity') {
      for (const act of activities) {
        if (matchesPattern(act.activity_type, trigger.pattern ?? '')) {
          triggerEvents.push({
            time: act.start_time,
            type: 'activity',
            value: act.activity_type,
          })
        }
      }
    } else if (trigger.type === 'tag') {
      // Tags are now activities — match by activity_type
      for (const act of activities) {
        if (matchesPattern(act.activity_type, trigger.pattern ?? '')) {
          triggerEvents.push({
            time: act.start_time,
            type: 'tag',
            value: act.activity_type,
          })
        }
      }
    } else if (trigger.type === 'productivity_category') {
      for (const prod of productivity) {
        const resolvedCatStr = prod.resolved_category?.join(' > ')
        const catStr = resolvedCatStr || prod.category
        if (catStr && matchesPattern(catStr, trigger.pattern ?? '')) {
          triggerEvents.push({
            time: prod.start_time,
            type: 'productivity_category',
            value: catStr,
          })
        }
      }
    } else if (trigger.type === 'productivity_app') {
      for (const prod of productivity) {
        if (matchesPattern(prod.activity, trigger.pattern ?? '')) {
          triggerEvents.push({
            time: prod.start_time,
            type: 'productivity_app',
            value: prod.activity,
          })
        }
      }
    }
  }

  // Check if this is a "simple" trigger setup (single trigger with default counts)
  // For simple triggers, we use actual event times; for compound, we use day-based windows
  const isSimpleTrigger =
    triggers.length === 1 && (triggers[0].min_count ?? 1) === 1 && (triggers[0].window_days ?? 1) === 1

  // Find windows where ALL trigger conditions are met
  const matchedWindowEnds: Date[] = []
  const unmatchedDays: string[] = []

  if (isSimpleTrigger) {
    // Simple case: use actual trigger event times
    const trigger = triggers[0]
    const matchingEvents = triggerEvents.filter(
      (e) => e.type === trigger.type && matchesPattern(e.value, trigger.pattern ?? ''),
    )

    // Use each trigger event time as a matched window
    for (const event of matchingEvents) {
      if (event.time >= start && event.time <= end) {
        matchedWindowEnds.push(event.time)
      }
    }

    // Track days without triggers for baseline
    const daysWithTriggers = new Set(matchingEvents.map((e) => getDayString(e.time)))
    for (let dayOffset = 0; dayOffset < analysisDays; dayOffset++) {
      const day = new Date(start)
      day.setDate(day.getDate() + dayOffset)
      const dayStr = getDayString(day)
      if (!daysWithTriggers.has(dayStr)) {
        unmatchedDays.push(dayStr)
      }
    }
  } else {
    // Compound case: iterate through each day and check if all conditions are met
    for (let dayOffset = 0; dayOffset < analysisDays; dayOffset++) {
      const windowEnd = new Date(start)
      windowEnd.setDate(windowEnd.getDate() + dayOffset)
      windowEnd.setHours(23, 59, 59, 999)

      let allConditionsMet = true

      for (const trigger of triggers) {
        const windowDays = trigger.window_days ?? 1
        const minCount = trigger.min_count ?? 1

        const windowStart = new Date(windowEnd)
        windowStart.setDate(windowStart.getDate() - windowDays + 1)
        windowStart.setHours(0, 0, 0, 0)

        // Count events matching this trigger in the window
        const count = triggerEvents.filter((e) => {
          if (e.type !== trigger.type) return false
          if (!matchesPattern(e.value, trigger.pattern ?? '')) return false
          return e.time >= windowStart && e.time <= windowEnd
        }).length

        if (count < minCount) {
          allConditionsMet = false
          break
        }
      }

      if (allConditionsMet && triggers.length > 0) {
        matchedWindowEnds.push(windowEnd)
      } else {
        unmatchedDays.push(getDayString(windowEnd))
      }
    }
  }

  // Calculate outcomes for each lag window
  const postTrigger: Record<string, LagResult> = {}

  // Get outcome events/data for tag outcomes
  const outcomeTagEvents =
    outcome.type === 'tag'
      ? activities.filter((a) => matchesPattern(a.activity_type, outcome.pattern)).map((a) => a.start_time)
      : []

  for (const lag of lagWindows) {
    const lagMs = parseLagWindow(lag)
    if (lagMs === null) continue

    if (outcome.type === 'tag') {
      // Count how many matched windows had the outcome tag within the lag window
      let windowsWithOutcome = 0

      for (const windowEnd of matchedWindowEnds) {
        const lagEnd = new Date(windowEnd.getTime() + lagMs)

        const hasOutcome = outcomeTagEvents.some((t) => t > windowEnd && t <= lagEnd)
        if (hasOutcome) windowsWithOutcome++
      }

      const probability = matchedWindowEnds.length > 0 ? windowsWithOutcome / matchedWindowEnds.length : 0

      // Calculate baseline probability (outcome on days without triggers)
      const daysWithOutcome = new Set(outcomeTagEvents.map(getDayString))
      const baselineDaysWithOutcome = unmatchedDays.filter((d) => daysWithOutcome.has(d)).length
      const baselineProbability =
        unmatchedDays.length > 0 ? baselineDaysWithOutcome / unmatchedDays.length : 0
      const relativeRisk = baselineProbability > 0 ? probability / baselineProbability : 0

      postTrigger[lag] = {
        occurrences: windowsWithOutcome,
        probability: Math.round(probability * 100) / 100,
        relative_risk: Math.round(relativeRisk * 100) / 100,
      }
    } else if (outcome.type === 'metric') {
      // Collect metric values within the lag window after each matched window
      const valuesAfterTrigger: number[] = []

      for (const windowEnd of matchedWindowEnds) {
        const lagEnd = new Date(windowEnd.getTime() + lagMs)

        const valuesInWindow = metricData
          .filter(([time]) => time > windowEnd && time <= lagEnd)
          .map(([, value]) => value)

        valuesAfterTrigger.push(...valuesInWindow)
      }

      const meanAfter = mean(valuesAfterTrigger)
      const stddevAfter = stddev(valuesAfterTrigger)

      // Calculate baseline (values on days without triggers)
      const unmatchedDaysSet = new Set(unmatchedDays)
      const baselineValues = metricData
        .filter(([time]) => unmatchedDaysSet.has(getDayString(time)))
        .map(([, value]) => value)

      const baselineMean = mean(baselineValues)
      const delta =
        meanAfter !== null && baselineMean !== null
          ? Math.round((meanAfter - baselineMean) * 100) / 100
          : null

      postTrigger[lag] = {
        delta_from_baseline: delta,
        mean: meanAfter !== null ? Math.round(meanAfter * 100) / 100 : null,
        sample_count: valuesAfterTrigger.length,
        stddev: stddevAfter !== null ? Math.round(stddevAfter * 100) / 100 : null,
      }
    } else if (outcome.type === 'productivity') {
      // Sum time in the specified category/app within the lag window
      let totalMinutes = 0
      let daysCounted = 0

      for (const windowEnd of matchedWindowEnds) {
        const lagEnd = new Date(windowEnd.getTime() + lagMs)
        daysCounted++

        for (const prod of productivity) {
          if (prod.start_time <= windowEnd || prod.start_time > lagEnd) continue

          const prodCatStr = prod.resolved_category?.join(' > ') || prod.category
          const matchesCategory =
            !outcome.category || (prodCatStr && matchesPattern(prodCatStr, outcome.category))
          const matchesApp = !outcome.app || matchesPattern(prod.activity, outcome.app)

          if (matchesCategory && matchesApp) {
            totalMinutes += prod.duration_sec / 60
          }
        }
      }

      // Calculate baseline
      const lagDays = lagMs / (24 * 60 * 60 * 1000)
      let baselineTotalMinutes = 0
      let baselineDays = 0
      const unmatchedDaysSet = new Set(unmatchedDays)

      for (const prod of productivity) {
        const dayStr = getDayString(prod.start_time)
        if (!unmatchedDaysSet.has(dayStr)) continue

        const matchesCategory =
          !outcome.category || (prod.category && matchesPattern(prod.category, outcome.category))
        const matchesApp = !outcome.app || matchesPattern(prod.activity, outcome.app)

        if (matchesCategory && matchesApp) {
          baselineTotalMinutes += prod.duration_sec / 60
        }
      }
      baselineDays = unmatchedDays.length

      const avgMinutesPerDay = daysCounted > 0 ? totalMinutes / (daysCounted * lagDays) : 0
      const baselineAvgMinutes = baselineDays > 0 ? baselineTotalMinutes / baselineDays : 0
      const delta =
        avgMinutesPerDay > 0 && baselineAvgMinutes > 0
          ? Math.round((avgMinutesPerDay - baselineAvgMinutes) * 100) / 100
          : null

      postTrigger[lag] = {
        avg_minutes_per_day: Math.round(avgMinutesPerDay * 100) / 100,
        delta_from_baseline: delta,
        total_minutes: Math.round(totalMinutes * 100) / 100,
      }
    }
  }

  // Calculate baseline stats
  let baseline: BaselineStats

  if (outcome.type === 'tag') {
    const daysWithOutcome = new Set(outcomeTagEvents.map(getDayString))
    const probability = analysisDays > 0 ? daysWithOutcome.size / analysisDays : 0

    baseline = {
      description: 'P(outcome on any given day)',
      probability: Math.round(probability * 100) / 100,
    }
  } else if (outcome.type === 'metric') {
    const unmatchedDaysSet = new Set(unmatchedDays)
    const baselineValues = metricData
      .filter(([time]) => unmatchedDaysSet.has(getDayString(time)))
      .map(([, value]) => value)

    baseline = {
      mean: mean(baselineValues) !== null ? Math.round(mean(baselineValues)! * 100) / 100 : null,
      sample_count: baselineValues.length,
      stddev: stddev(baselineValues) !== null ? Math.round(stddev(baselineValues)! * 100) / 100 : null,
    }
  } else {
    // productivity
    let baselineTotalMinutes = 0
    const unmatchedDaysSet = new Set(unmatchedDays)

    for (const prod of productivity) {
      const dayStr = getDayString(prod.start_time)
      if (!unmatchedDaysSet.has(dayStr)) continue

      const matchesCategory =
        !outcome.category || (prod.category && matchesPattern(prod.category, outcome.category))
      const matchesApp = !outcome.app || matchesPattern(prod.activity, outcome.app)

      if (matchesCategory && matchesApp) {
        baselineTotalMinutes += prod.duration_sec / 60
      }
    }

    const avgMinutesPerDay = unmatchedDays.length > 0 ? baselineTotalMinutes / unmatchedDays.length : 0

    baseline = {
      avg_minutes_per_day: Math.round(avgMinutesPerDay * 100) / 100,
      total_minutes: Math.round(baselineTotalMinutes * 100) / 100,
    }
  }

  // Calculate chi-squared for tag outcomes (using first lag window)
  let chiSquaredResult: { chiSquared: number; pValue: number } | null = null

  if (outcome.type === 'tag' && matchedWindowEnds.length > 0) {
    const primaryLag = postTrigger[lagWindows[0]] as TagLagResult | undefined
    if (primaryLag) {
      const triggersWithOutcome = Math.round(primaryLag.probability * matchedWindowEnds.length)
      const triggersWithoutOutcome = matchedWindowEnds.length - triggersWithOutcome

      const daysWithOutcome = new Set(outcomeTagEvents.map(getDayString))
      const nonTriggersWithOutcome = unmatchedDays.filter((d) => daysWithOutcome.has(d)).length
      const nonTriggersWithoutOutcome = unmatchedDays.length - nonTriggersWithOutcome

      chiSquaredResult = chiSquaredTest([
        [triggersWithOutcome, triggersWithoutOutcome],
        [Math.max(0, nonTriggersWithOutcome), Math.max(0, nonTriggersWithoutOutcome)],
      ])
    }
  }

  return {
    baseline,
    outcome,
    period: {
      days: analysisDays,
      end: end.toISOString(),
      start: start.toISOString(),
    },
    post_trigger: postTrigger,
    statistical_significance: {
      chi_squared:
        chiSquaredResult?.chiSquared !== undefined
          ? Math.round(chiSquaredResult.chiSquared * 100) / 100
          : null,
      p_value:
        chiSquaredResult?.pValue !== undefined ? Math.round(chiSquaredResult.pValue * 1000) / 1000 : null,
    },
    triggers,
    windows_matched: matchedWindowEnds.length,
  }
}

/**
 * Event-outcome path for getGenericCorrelation: delegates to the exposure-
 * corrected onset engine and packages it into a GenericCorrelationResult under
 * the `event_outcome` block. The legacy fields (post_trigger, averaged
 * baseline) are not meaningful here and are left empty.
 */
async function getGenericEventOutcome(
  user: string,
  triggers: TriggerCondition[],
  outcome: Extract<OutcomeConfig, { type: 'event' }>,
  lagWindows: string[],
  periodDays: number,
  sync: SyncProvider | undefined,
  options: GenericCorrelationOptions,
): Promise<GenericCorrelationResult> {
  if (sync) {
    await Promise.all([
      sync.syncOuraIfNeeded(user, 'tags'),
      sync.syncOuraIfNeeded(user, 'sessions'),
      sync.syncRescueTimeIfNeeded(user),
      sync.syncCalendarsIfNeeded(user),
    ])
  }

  const eventOutcome = await getCompoundEventOutcome(user, triggers, outcome, lagWindows, {
    denominator: options.denominator,
    periodDays,
    periodEnd: options.periodEnd,
    periodStart: options.periodStart,
  })

  const primaryLag = eventOutcome.per_lag[0]

  return {
    baseline: { description: 'Event-outcome mode — see event_outcome block', probability: 0 },
    event_outcome: {
      collapse_gap_days: eventOutcome.collapse_gap_days,
      denominator: eventOutcome.denominator,
      known_days: eventOutcome.known_days,
      onsets: eventOutcome.onsets,
      outcome_days: eventOutcome.outcome_days,
      per_lag: eventOutcome.per_lag,
      trigger_days: eventOutcome.trigger_days,
    },
    outcome,
    period: eventOutcome.period,
    post_trigger: {},
    statistical_significance: {
      chi_squared: primaryLag?.chi_squared ?? null,
      p_value: primaryLag?.p_value ?? null,
    },
    triggers,
    windows_matched: eventOutcome.trigger_days,
  }
}
