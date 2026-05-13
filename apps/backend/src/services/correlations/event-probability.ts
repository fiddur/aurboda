/**
 * Event probability analysis for discrete event correlation.
 */

import type { SyncProvider } from '../queries/index.ts'
import type { EventProbabilityResult, LagWindowResult } from './types.ts'

import { getAllActivitiesInRange } from '../../db/index.ts'
import { chiSquaredTest } from './utils.ts'

/**
 * Get probability of outcome event after trigger event (for discrete event correlation).
 */
// eslint-disable-next-line complexity -- TODO: refactor
export async function getEventProbability(
  user: string,
  trigger: { type: 'activity' | 'tag'; value: string },
  outcome: { type: 'tag'; pattern: string },
  lagWindows: string[] = ['12h', '24h', '36h', '48h'],
  periodDays: number = 365,
  sync?: SyncProvider,
): Promise<EventProbabilityResult> {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setDate(start.getDate() - periodDays)
  start.setHours(0, 0, 0, 0)

  // Auto-sync if provider available
  if (sync) {
    await Promise.all([
      sync.syncOuraIfNeeded(user, 'tags'),
      sync.syncOuraIfNeeded(user, 'sessions'),
      sync.syncCalendarsIfNeeded(user),
    ])
  }

  // Parse outcome pattern as regex
  const outcomeRegex = new RegExp(outcome.pattern, 'i')

  // Get trigger events
  let triggerEvents: Date[] = []

  const allActivities = await getAllActivitiesInRange(user, start, end)

  if (trigger.type === 'tag' || trigger.type === 'activity') {
    triggerEvents = allActivities
      .filter((a) => a.activity_type.toLowerCase().includes(trigger.value.toLowerCase()))
      .map((a) => a.start_time)
  }

  // Get all outcome events (activities matching pattern)
  const outcomeEvents = allActivities
    .filter((a) => outcomeRegex.test(a.activity_type))
    .map((a) => a.start_time)

  // Calculate baseline probability (outcome on any given day)
  const daysWithOutcome = new Set<string>()
  for (const event of outcomeEvents) {
    daysWithOutcome.add(event.toISOString().split('T')[0])
  }
  const baselineProbability = daysWithOutcome.size / periodDays

  // Calculate probability for each lag window
  const postTrigger: Record<string, LagWindowResult> = {}

  for (const lag of lagWindows) {
    // Parse lag (e.g., "24h" -> 24 hours)
    const lagMatch = lag.match(/^(\d+)([hd])$/)
    if (!lagMatch) continue

    const lagValue = parseInt(lagMatch[1], 10)
    const lagUnit = lagMatch[2]
    const lagMs = lagUnit === 'h' ? lagValue * 60 * 60 * 1000 : lagValue * 24 * 60 * 60 * 1000

    // Count outcomes within lag window after each trigger
    let outcomesAfterTrigger = 0
    const triggersWithOutcome = new Set<number>()

    for (let i = 0; i < triggerEvents.length; i++) {
      const triggerTime = triggerEvents[i]
      const windowEnd = new Date(triggerTime.getTime() + lagMs)

      for (const outcomeTime of outcomeEvents) {
        if (outcomeTime > triggerTime && outcomeTime <= windowEnd) {
          outcomesAfterTrigger++
          triggersWithOutcome.add(i)
          break // Only count first outcome per trigger
        }
      }
    }

    const probability = triggerEvents.length > 0 ? triggersWithOutcome.size / triggerEvents.length : 0
    const relativeRisk = baselineProbability > 0 ? probability / baselineProbability : 0

    postTrigger[lag] = {
      occurrences: outcomesAfterTrigger,
      probability: Math.round(probability * 100) / 100,
      relative_risk: Math.round(relativeRisk * 100) / 100,
    }
  }

  // Calculate chi-squared for overall significance (using 24h window as primary)
  const primaryLag = postTrigger['24h'] ?? postTrigger[lagWindows[0]]
  let chiSquaredResult: { chiSquared: number; pValue: number } | null = null

  if (primaryLag && triggerEvents.length > 0) {
    // Build 2x2 contingency table: trigger (yes/no) x outcome within window (yes/no)
    const triggersWithOutcome24h = Math.round(primaryLag.probability * triggerEvents.length)
    const triggersWithoutOutcome = triggerEvents.length - triggersWithOutcome24h
    const nonTriggersWithOutcome = daysWithOutcome.size - triggersWithOutcome24h
    const nonTriggersWithoutOutcome = periodDays - triggerEvents.length - nonTriggersWithOutcome

    chiSquaredResult = chiSquaredTest([
      [triggersWithOutcome24h, triggersWithoutOutcome],
      [Math.max(0, nonTriggersWithOutcome), Math.max(0, nonTriggersWithoutOutcome)],
    ])
  }

  return {
    baseline: {
      description: 'P(outcome on any given day)',
      probability: Math.round(baselineProbability * 100) / 100,
    },
    outcome: {
      pattern: outcome.pattern,
      type: outcome.type,
    },
    period: {
      end: end.toISOString(),
      start: start.toISOString(),
    },
    post_trigger: postTrigger,
    sample_size: {
      days_analyzed: periodDays,
      outcome_events: outcomeEvents.length,
      trigger_events: triggerEvents.length,
    },
    statistical_significance: {
      chi_squared:
        chiSquaredResult?.chiSquared !== undefined
          ? Math.round(chiSquaredResult.chiSquared * 100) / 100
          : null,
      p_value:
        chiSquaredResult?.pValue !== undefined ? Math.round(chiSquaredResult.pValue * 1000) / 1000 : null,
    },
    trigger: {
      type: trigger.type,
      value: trigger.value,
    },
  }
}
