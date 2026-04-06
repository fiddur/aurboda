/**
 * Deduction engine — evaluates rules to automatically create activities from data conditions.
 *
 * Core algorithm:
 * 1. Each condition resolves to TimeRange[] within an evaluation window
 * 2. Multiple conditions are intersected (AND logic)
 * 3. Optional merge_gap coalesces nearby ranges
 * 4. Resulting ranges become activities with source 'deduction-rule'
 * 5. Rules are evaluated in priority order for chaining support
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
  insertActivity: (user: string, activity: Activity) => Promise<void>
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

const conditionResolvers: Record<string, ConditionResolver> = {
  activity: resolveActivity,
  screentime_category: resolveScreentimeCategory,
  tag: resolveTag,
}

// ============================================================================
// Rule evaluation
// ============================================================================

/**
 * Evaluate a single deduction rule within a time window.
 * Returns IDs of activities created/kept.
 */
export const evaluateRule = async (
  user: string,
  rule: DeductionRule,
  window: EvaluationWindow,
  deps: DeductionEngineDeps,
): Promise<string[]> => {
  // Resolve each condition to time ranges
  const rangeSets: TimeRange[][] = []
  for (const condition of rule.conditions) {
    const resolver = conditionResolvers[condition.kind]
    if (!resolver) continue
    const ranges = await resolver(user, condition, window, deps)
    rangeSets.push(ranges)
  }

  if (rangeSets.length === 0) return []

  // Intersect all range sets (AND logic)
  let result = rangeSets[0]
  for (let i = 1; i < rangeSets.length; i++) {
    result = intersectTimeRanges(result, rangeSets[i])
    if (result.length === 0) return [] // Early exit
  }

  // Apply merge gap if configured
  if (rule.merge_gap_seconds) {
    result = mergeRangesWithGap(result, rule.merge_gap_seconds * 1000)
  }

  // Create activities for each resulting range
  const createdIds: string[] = []
  for (const range of result) {
    const id = randomUUID()
    await deps.insertActivity(user, {
      activity_type: rule.output_activity_type,
      data: { rule_id: rule.id, rule_name: rule.name },
      end_time: range.end,
      id,
      source: 'deduction-rule',
      start_time: range.start,
      title: rule.output_title ?? rule.name,
    })
    createdIds.push(id)
  }

  return createdIds
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
      const createdIds = await evaluateRule(user, rule, window, deps)

      // Clean up stale activities from previous evaluations
      await deps.deleteStaleRuleActivities(user, rule.id, window.start, window.end, createdIds)

      const durationMs = Date.now() - startMs
      await deps.insertRuleRun(user, {
        activities_created: createdIds.length,
        duration_ms: durationMs,
        rule_id: rule.id,
        window_end: window.end,
        window_start: window.start,
      })

      totalActivities += createdIds.length
      totalRules++
    }
  }

  return { activities_created: totalActivities, rules_evaluated: totalRules }
}
