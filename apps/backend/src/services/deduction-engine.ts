/**
 * Deduction engine — evaluates rules to automatically create or enrich activities from data conditions.
 *
 * Core algorithm:
 * 1. Each condition resolves to TimeRange[] within an evaluation window
 * 2. Multiple conditions are intersected (AND logic)
 * 3. Optional merge_gap coalesces nearby ranges
 * 4. In 'create' mode: resulting ranges become activities with source 'deduction-rule'
 * 5. In 'enrich' mode: matching target activities have output_data merged into their data
 * 6. Rules are evaluated in priority order for chaining support
 */

import type { Condition, DeductionRule } from '@aurboda/api-spec'

import { randomUUID } from 'node:crypto'

import type { Activity } from '../db/types.ts'

// ============================================================================
// Types
// ============================================================================

export interface TimeRange {
  start: Date
  end: Date
}

export interface EvaluationWindow {
  start: Date
  end: Date
}

export interface RuleEvaluationResult {
  rule_id: string
  activities_created: number
  duration_ms: number
}

export interface DeductionEngineDeps {
  getActivities: (user: string, activityType: string, window: EvaluationWindow) => Promise<TimeRange[]>
  getTags: (user: string, tagName: string, window: EvaluationWindow) => Promise<TimeRange[]>
  getScreentime: (user: string, category: string[], window: EvaluationWindow) => Promise<TimeRange[]>
  getActivitiesWithData: (
    user: string,
    activityType: string,
    field: string,
    operator: string,
    value: string | number | boolean | undefined,
    window: EvaluationWindow,
  ) => Promise<TimeRange[]>
  getLocationVisits: (user: string, locationName: string, window: EvaluationWindow) => Promise<TimeRange[]>
  insertActivity: (user: string, activity: Activity) => Promise<string | void>
  enrichActivities: (
    user: string,
    activityType: string,
    ranges: TimeRange[],
    data: Record<string, unknown>,
    ruleId: string,
  ) => Promise<string[]>
  deleteStaleRuleActivities: (
    user: string,
    ruleId: string,
    windowStart: Date,
    windowEnd: Date,
    keepIds: string[],
  ) => Promise<number>
  insertRuleRun: (
    user: string,
    run: {
      rule_id: string
      window_start: Date
      window_end: Date
      activities_created: number
      duration_ms: number
    },
  ) => Promise<void>
  getEarliestActivityTime: (user: string) => Promise<Date | null>
}

// ============================================================================
// Time range intersection (pure, unit-testable)
// ============================================================================

/**
 * Intersect two sorted arrays of time ranges.
 * Returns ranges where both A and B overlap.
 */
export const intersectTimeRanges = (a: TimeRange[], b: TimeRange[]): TimeRange[] => {
  const result: TimeRange[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    const start = a[i].start > b[j].start ? a[i].start : b[j].start
    const end = a[i].end < b[j].end ? a[i].end : b[j].end

    if (start < end) {
      result.push({ end, start })
    }

    // Advance the range that ends first
    if (a[i].end < b[j].end) {
      i++
    } else {
      j++
    }
  }

  return result
}

/**
 * Merge overlapping or adjacent ranges within a gap threshold.
 */
export const mergeRangesWithGap = (ranges: TimeRange[], gapMs: number): TimeRange[] => {
  if (ranges.length === 0) return []

  const sorted = [...ranges].sort((a, b) => a.start.getTime() - b.start.getTime())
  const result: TimeRange[] = [{ ...sorted[0] }]

  for (let i = 1; i < sorted.length; i++) {
    const current = result[result.length - 1]
    const next = sorted[i]

    if (next.start.getTime() - current.end.getTime() <= gapMs) {
      // Extend current range
      if (next.end > current.end) {
        current.end = next.end
      }
    } else {
      result.push({ ...next })
    }
  }

  return result
}

// ============================================================================
// Condition resolvers
// ============================================================================

type ConditionResolver = (
  user: string,
  condition: Condition,
  window: EvaluationWindow,
  deps: DeductionEngineDeps,
) => Promise<TimeRange[]>

const resolveActivity: ConditionResolver = async (user, condition, window, deps) => {
  if (condition.kind !== 'activity') return []
  return deps.getActivities(user, condition.activity_type, window)
}

const resolveTag: ConditionResolver = async (user, condition, window, deps) => {
  if (condition.kind !== 'tag') return []
  return deps.getTags(user, condition.tag_name, window)
}

const resolveScreentimeCategory: ConditionResolver = async (user, condition, window, deps) => {
  if (condition.kind !== 'screentime_category') return []
  return deps.getScreentime(user, condition.category, window)
}

const resolveActivityData: ConditionResolver = async (user, condition, window, deps) => {
  if (condition.kind !== 'activity_data') return []
  return deps.getActivitiesWithData(
    user,
    condition.activity_type,
    condition.field,
    condition.operator,
    condition.value,
    window,
  )
}

const resolveLocation: ConditionResolver = async (user, condition, window, deps) => {
  if (condition.kind !== 'location') return []
  return deps.getLocationVisits(user, condition.location_name, window)
}

const conditionResolvers: Record<string, ConditionResolver> = {
  activity: resolveActivity,
  activity_data: resolveActivityData,
  location: resolveLocation,
  screentime_category: resolveScreentimeCategory,
  tag: resolveTag,
}

// ============================================================================
// Rule evaluation
// ============================================================================

/**
 * Resolve conditions and intersect time ranges for a rule.
 * Shared between create, enrich, and dry-run paths.
 */
const resolveConditions = async (
  user: string,
  rule: DeductionRule,
  window: EvaluationWindow,
  deps: DeductionEngineDeps,
): Promise<TimeRange[]> => {
  const rangeSets: TimeRange[][] = []
  for (const condition of rule.conditions) {
    const resolver = conditionResolvers[condition.kind]
    if (!resolver) continue
    const ranges = await resolver(user, condition, window, deps)
    rangeSets.push(ranges)
  }

  if (rangeSets.length === 0) return []

  let result = rangeSets[0]
  for (let i = 1; i < rangeSets.length; i++) {
    result = intersectTimeRanges(result, rangeSets[i])
    if (result.length === 0) return []
  }

  if (rule.merge_gap_seconds) {
    result = mergeRangesWithGap(result, rule.merge_gap_seconds * 1000)
  }

  return result
}

export interface EvaluateRuleResult {
  affected_ids: string[]
  would_affect: number
}

/**
 * Evaluate a single deduction rule within a time window.
 * When dryRun is true, returns the count of activities that would be affected without making changes.
 */
export const evaluateRule = async (
  user: string,
  rule: DeductionRule,
  window: EvaluationWindow,
  deps: DeductionEngineDeps,
  dryRun = false,
): Promise<EvaluateRuleResult> => {
  const result = await resolveConditions(user, rule, window, deps)
  if (result.length === 0) return { affected_ids: [], would_affect: 0 }

  // Enrich mode: patch existing activities
  if (rule.mode === 'enrich' && rule.target_activity_type) {
    if (dryRun) {
      // Count how many target activities overlap the ranges without modifying them
      const targetRanges = await deps.getActivities(user, rule.target_activity_type, window)
      const overlapping = intersectTimeRanges(result, targetRanges)
      return { affected_ids: [], would_affect: overlapping.length }
    }
    const enrichedIds = await deps.enrichActivities(
      user,
      rule.target_activity_type,
      result,
      rule.output_data ?? {},
      rule.id,
    )
    return { affected_ids: enrichedIds, would_affect: enrichedIds.length }
  }

  // Create mode (default)
  if (dryRun) {
    return { affected_ids: [], would_affect: result.length }
  }

  const createdIds: string[] = []
  for (const range of result) {
    const id = randomUUID()
    await deps.insertActivity(user, {
      activity_type: rule.output_activity_type,
      data: { rule_id: rule.id, rule_name: rule.name, ...rule.output_data },
      end_time: range.end,
      id,
      source: 'deduction-rule',
      start_time: range.start,
      title: rule.output_title ?? rule.name,
    })
    createdIds.push(id)
  }

  return { affected_ids: createdIds, would_affect: createdIds.length }
}

/**
 * Evaluate all enabled rules in priority order.
 * Rules at priority N complete before priority N+1 starts (for chaining).
 */
export const evaluateAllRules = async (
  user: string,
  rules: DeductionRule[],
  window: EvaluationWindow,
  deps: DeductionEngineDeps,
  dryRun = false,
): Promise<{ rules_evaluated: number; activities_created: number }> => {
  // Group by priority
  const byPriority = new Map<number, DeductionRule[]>()
  for (const rule of rules) {
    const group = byPriority.get(rule.priority) ?? []
    group.push(rule)
    byPriority.set(rule.priority, group)
  }

  const priorities = [...byPriority.keys()].sort((a, b) => a - b)
  let totalActivities = 0
  let totalRules = 0

  for (const priority of priorities) {
    const group = byPriority.get(priority)!
    for (const rule of group) {
      const startMs = Date.now()
      const { affected_ids, would_affect } = await evaluateRule(user, rule, window, deps, dryRun)

      if (!dryRun) {
        // Clean up stale activities from previous evaluations (only for create mode)
        if (rule.mode !== 'enrich') {
          await deps.deleteStaleRuleActivities(user, rule.id, window.start, window.end, affected_ids)
        }

        const durationMs = Date.now() - startMs
        await deps.insertRuleRun(user, {
          activities_created: affected_ids.length,
          duration_ms: durationMs,
          rule_id: rule.id,
          window_end: window.end,
          window_start: window.start,
        })
      }

      totalActivities += dryRun ? would_affect : affected_ids.length
      totalRules++
    }
  }

  return { activities_created: totalActivities, rules_evaluated: totalRules }
}

/**
 * Build a full retroactive evaluation window for a user.
 * Goes back to the earliest activity, or falls back to the given number of days.
 */
export const buildFullWindow = async (
  user: string,
  deps: DeductionEngineDeps,
  fallbackDays = 90,
): Promise<EvaluationWindow> => {
  const end = new Date()
  const earliest = await deps.getEarliestActivityTime(user)
  const start = earliest ?? new Date(end.getTime() - fallbackDays * 24 * 60 * 60 * 1000)
  return { end, start }
}
