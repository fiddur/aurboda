/**
 * Core algorithm:
 * 1. Each condition resolves to TimeRange[] within an evaluation window
 * 2. Multiple conditions are intersected (AND logic)
 * 3. Optional merge_gap coalesces nearby ranges
 * 4. In 'create' mode: resulting ranges become activities with source 'deduction-rule'
 * 5. In 'enrich' mode: matching target activities have output_data merged into their data
 *    (and, with output_title_field, that data field into their title)
 *    (and, with output_category, adds or removes the rule's entry in data.run_categories)
 *    In 'retype' mode: the activities of the rule's single 'activity' condition that overlap the
 *    result change type to output_activity_type
 * 6. Rules are evaluated in priority order for chaining support
 */

import type {
  ActivityCondition,
  ActivityFeatureCondition,
  ActivityFeatures,
  Condition,
  DeductionRule,
  MediaPlay,
} from '@aurboda/api-spec'

import { randomUUID } from 'node:crypto'

import type { Activity } from '../db/types.ts'

import { auditError, auditWarn } from './audit-log.ts'
import { applyCategory, categoryReasons } from './deduction-category.ts'
import {
  matchesMediaCondition,
  mediaConditionsOf,
  pickLongestPlay,
  playRange,
  stripTitle,
} from './media-plays.ts'

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

export interface EnrichOptions {
  /** Per-activity data merged over the static data, given the activity's span. */
  dataFor?: (span: TimeRange) => Record<string, unknown>
  /** Keys this rule may overwrite when it wrote the activity's enrichment before. */
  overwriteKeys?: string[]
}

export interface MatchedActivity extends TimeRange {
  id: string
}

export interface CategorisableActivity extends MatchedActivity {
  data: Record<string, unknown> | null
  /**
   * The row the merged view shows (of the type, not superseded, no live override): only it may
   * carry the category. Other rows are listed when they still hold the rule's entry, to lose it.
   */
  primary: boolean
}

export interface RetypeChange {
  activity_type: string
  output_data?: Record<string, unknown>
  rule_id: string
  title?: string
}

export interface DeductionEngineDeps {
  getActivities: (user: string, activityType: string, window: EvaluationWindow) => Promise<TimeRange[]>
  getScreentime: (user: string, category: string[], window: EvaluationWindow) => Promise<TimeRange[]>
  getActivitiesWithData: (
    user: string,
    activityType: string,
    field: string,
    operator: string,
    value: string | number | boolean | undefined,
    window: EvaluationWindow,
  ) => Promise<TimeRange[]>
  findActivities: (
    user: string,
    condition: ActivityCondition,
    window: EvaluationWindow,
    retypeTo?: string,
  ) => Promise<MatchedActivity[]>
  findActivitiesByFeature: (
    user: string,
    condition: ActivityFeatureCondition,
    window: EvaluationWindow,
  ) => Promise<(MatchedActivity & { value: number })[]>
  getActivityFeatures: (user: string, activityId: string) => Promise<ActivityFeatures | null>
  /**
   * Overlapping the window: the primary rows of the type (and its descendants), and any row
   * whose run_categories holds an entry of the rule.
   */
  getCategorisableActivities: (
    user: string,
    activityType: string,
    ruleId: string,
    window: EvaluationWindow,
  ) => Promise<CategorisableActivity[]>
  getActivityData: (user: string, activityId: string) => Promise<Record<string, unknown> | null>
  getLocationVisits: (user: string, locationName: string, window: EvaluationWindow) => Promise<TimeRange[]>
  /**
   * Merges the patch into the activity's data only while its run_categories still equals
   * `expectedCategories` (undefined: absent); false when it changed meanwhile.
   */
  patchActivityData: (
    user: string,
    activityId: string,
    patch: Record<string, unknown>,
    expectedCategories: unknown,
  ) => Promise<boolean>
  getScrobbles: (
    user: string,
    artist: string[] | undefined,
    track: string | undefined,
    matchMode: 'exact' | 'contains',
    durationSeconds: number,
    window: EvaluationWindow,
  ) => Promise<TimeRange[]>
  insertActivity: (user: string, activity: Activity) => Promise<{ id: string | undefined; changed: boolean }>
  enrichActivities: (
    user: string,
    activityType: string,
    ranges: TimeRange[],
    data: Record<string, unknown>,
    ruleId: string,
    options?: EnrichOptions,
  ) => Promise<string[]>
  getMediaPlays: (user: string, window: EvaluationWindow) => Promise<MediaPlay[]>
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
  retypeActivity: (user: string, id: string, change: RetypeChange) => Promise<boolean>
  /** Ids of the activities whose title the rule changed, or with dryRun would change. */
  retitleActivities: (
    user: string,
    activityType: string,
    ranges: TimeRange[],
    field: string,
    ruleId: string,
    dryRun?: boolean,
  ) => Promise<string[]>
}

/**
 * Intersect two sorted arrays of time ranges.
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

export const mergeRangesWithGap = (ranges: TimeRange[], gapMs: number): TimeRange[] => {
  if (ranges.length === 0) return []

  const sorted = [...ranges].sort((a, b) => a.start.getTime() - b.start.getTime())
  const result: TimeRange[] = [{ ...sorted[0] }]

  for (let i = 1; i < sorted.length; i++) {
    const current = result[result.length - 1]
    const next = sorted[i]

    if (next.start.getTime() - current.end.getTime() <= gapMs) {
      if (next.end > current.end) {
        current.end = next.end
      }
    } else {
      result.push({ ...next })
    }
  }

  return result
}

type ConditionResolver = (
  user: string,
  condition: Condition,
  window: EvaluationWindow,
  deps: DeductionEngineDeps,
) => Promise<TimeRange[]>

const resolveActivity: ConditionResolver = async (user, condition, window, deps) => {
  if (condition.kind !== 'activity') return []
  if (condition.data_filters?.length || condition.title?.trim()) {
    const matched = await deps.findActivities(user, condition, window)
    return matched.map(({ end, start }) => ({ end, start }))
  }
  return deps.getActivities(user, condition.activity_type, window)
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

const resolveAfterDate: ConditionResolver = async (_user, condition, window) => {
  if (condition.kind !== 'after_date') return []
  const since = new Date(condition.date)
  if (since >= window.end) return []
  return [{ start: since > window.start ? since : window.start, end: window.end }]
}

const resolveScrobble: ConditionResolver = async (user, condition, window, deps) => {
  if (condition.kind !== 'scrobble') return []
  return deps.getScrobbles(
    user,
    condition.artist,
    condition.track,
    condition.match_mode ?? 'exact',
    condition.duration_seconds,
    window,
  )
}

const resolveMedia: ConditionResolver = async (user, condition, window, deps) => {
  if (condition.kind !== 'media') return []
  const plays = await deps.getMediaPlays(user, window)
  const ranges = plays.filter((p) => matchesMediaCondition(p, condition)).map(playRange)
  return mergeRangesWithGap(ranges, 0)
}

const resolveActivityFeature: ConditionResolver = async (user, condition, window, deps) => {
  if (condition.kind !== 'activity_feature') return []
  const matched = await deps.findActivitiesByFeature(user, condition, window)
  return mergeRangesWithGap(
    matched.map(({ end, start }) => ({ end, start })),
    0,
  )
}

const conditionResolvers: Record<string, ConditionResolver> = {
  activity: resolveActivity,
  activity_data: resolveActivityData,
  activity_feature: resolveActivityFeature,
  after_date: resolveAfterDate,
  location: resolveLocation,
  media: resolveMedia,
  scrobble: resolveScrobble,
  screentime_category: resolveScreentimeCategory,
}

/**
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type EnrichAction = 'fill' | 'replace' | 'adopt' | 'skip'

const enrichAction = (current: unknown, value: unknown, owned: boolean, written: unknown): EnrichAction => {
  if (current === undefined || current === null) return 'fill'
  if (!owned) return 'skip'
  if (current === value) return 'adopt'
  return written === current ? 'replace' : 'skip'
}

/**
 * The patch enrichment writes onto one activity, or null when nothing changes. Keys are only
 * filled when missing, except `overwriteKeys`, which are also replaced while they still hold the
 * value this rule wrote (`_enriched_values`) — so re-running an edited rule updates its own
 * values but never one someone else set or edited by hand. A row enriched before
 * `_enriched_values` existed has no record: the rule adopts a key whose value already equals
 * what it would write, and otherwise treats the value as edited.
 */
export const computeEnrichPatch = (
  existing: Record<string, unknown>,
  data: Record<string, unknown>,
  ruleId: string,
  overwriteKeys: string[] = [],
): Record<string, unknown> | null => {
  const ownedByRule = existing._enriched_by === ruleId
  const written = ownedByRule && isRecord(existing._enriched_values) ? existing._enriched_values : {}
  const patch: Record<string, unknown> = {}
  const values: Record<string, unknown> = { ...written }
  for (const [key, value] of Object.entries(data)) {
    const tracked = overwriteKeys.includes(key)
    const action = enrichAction(existing[key], value, ownedByRule && tracked, written[key])
    if (action === 'fill' || action === 'replace') patch[key] = value
    if (tracked && action !== 'skip') values[key] = value
  }
  const valuesChanged = Object.entries(values).some(([key, value]) => written[key] !== value)
  if (Object.keys(patch).length === 0 && !valuesChanged) return null
  patch._enriched_by = ruleId
  // Taking over from another rule drops its record, so its values never count as this rule's.
  if (valuesChanged || (!ownedByRule && existing._enriched_values !== undefined)) {
    patch._enriched_values = values
  }
  return patch
}

/**
 * For rules with output_media_field: the title of the longest play matching every media
 * condition within the activity's matched span, keyed by the output field.
 */
const buildMediaDataFor = async (
  user: string,
  rule: DeductionRule,
  matched: TimeRange[],
  window: EvaluationWindow,
  deps: DeductionEngineDeps,
): Promise<((span: TimeRange) => Record<string, unknown>) | undefined> => {
  const output = rule.output_media_field
  if (!output) return undefined
  const conditions = mediaConditionsOf(rule.conditions)
  const plays = (await deps.getMediaPlays(user, window)).filter((play) =>
    conditions.every((c) => matchesMediaCondition(play, c)),
  )
  return (span) => {
    const windows = intersectTimeRanges([span], matched)
    const play = pickLongestPlay(plays, windows)
    if (!play) return {}
    const value = stripTitle(play.title, output.strip_pattern)
    return value ? { [output.field]: value } : {}
  }
}

const withMemoizedMediaPlays = (deps: DeductionEngineDeps): DeductionEngineDeps => {
  const cache = new Map<string, Promise<MediaPlay[]>>()
  return {
    ...deps,
    getMediaPlays: (user, window) => {
      const key = `${user}|${window.start.getTime()}|${window.end.getTime()}`
      const cached = cache.get(key) ?? deps.getMediaPlays(user, window)
      cache.set(key, cached)
      return cached
    },
  }
}

export interface EvaluateRuleResult {
  /** Activities the rule actually wrote. A settled window counts 0. */
  activities_created: number
  /**
   * Every activity the rule claims in the window, changed or not: the stale cleanup keeps
   * these, so an unchanged re-upsert must still be listed.
   */
  affected_ids: string[]
  would_affect: number
}

const nothingAffected = (would_affect: number): EvaluateRuleResult => ({
  activities_created: 0,
  affected_ids: [],
  would_affect,
})

const allAffected = (ids: string[]): EvaluateRuleResult => ({
  activities_created: ids.length,
  affected_ids: ids,
  would_affect: ids.length,
})

const activityConditionsOf = (conditions: Condition[]): ActivityCondition[] =>
  conditions.filter((c): c is ActivityCondition => c.kind === 'activity')

const overlapsAny = (span: TimeRange, ranges: TimeRange[]): boolean =>
  ranges.some((r) => r.start < span.end && span.start < r.end)

const retype = async (
  user: string,
  rule: DeductionRule,
  matched: TimeRange[],
  window: EvaluationWindow,
  deps: DeductionEngineDeps,
  dryRun: boolean,
): Promise<EvaluateRuleResult> => {
  const [target, ...others] = activityConditionsOf(rule.conditions)
  if (!target || others.length > 0) return nothingAffected(0)

  const candidates = await deps.findActivities(user, target, window, rule.output_activity_type)
  const toRetype = candidates.filter((c) => overlapsAny(c, matched))
  if (dryRun) return nothingAffected(toRetype.length)

  const retypedIds: string[] = []
  for (const activity of toRetype) {
    const ok = await deps.retypeActivity(user, activity.id, {
      activity_type: rule.output_activity_type,
      output_data: rule.output_data,
      rule_id: rule.id,
      title: rule.output_title,
    })
    if (ok) retypedIds.push(activity.id)
  }
  return allAffected(retypedIds)
}

const countEnrichable = async (
  user: string,
  rule: DeductionRule,
  matched: TimeRange[],
  window: EvaluationWindow,
  deps: DeductionEngineDeps,
  dataFor: ((span: TimeRange) => Record<string, unknown>) | undefined,
): Promise<number> => {
  if (!dataFor && Object.keys(rule.output_data ?? {}).length === 0) return 0
  const targetRanges = await deps.getActivities(user, rule.output_activity_type, window)
  if (dataFor) return targetRanges.filter((target) => Object.keys(dataFor(target)).length > 0).length
  return intersectTimeRanges(matched, targetRanges).length
}

/**
 * Every activity of output_activity_type in the window gets the rule's run category while it
 * overlaps a match and loses it otherwise, so a re-tuned rule takes its category back from the
 * runs it no longer matches. Returns the ids written, or with dryRun those that would be.
 */
type CategoryWrite = 'unchanged' | 'changed' | 'conflict'

const categorise = async (
  user: string,
  rule: DeductionRule,
  matched: TimeRange[],
  window: EvaluationWindow,
  deps: DeductionEngineDeps,
  dryRun: boolean,
): Promise<string[]> => {
  if (!rule.output_category) return []
  const candidates = await deps.getCategorisableActivities(user, rule.output_activity_type, rule.id, window)
  const changed: string[] = []
  for (const activity of candidates) {
    const wanted = activity.primary && overlapsAny(activity, matched)
    const reasons = wanted ? categoryReasons(rule, await deps.getActivityFeatures(user, activity.id)) : []
    const write = async (data: Record<string, unknown>): Promise<CategoryWrite> => {
      const patch = applyCategory(data, rule, wanted, reasons)
      if (!patch) return 'unchanged'
      if (dryRun) return 'changed'
      const written = await deps.patchActivityData(user, activity.id, patch, data.run_categories)
      return written ? 'changed' : 'conflict'
    }
    let outcome = await write(activity.data ?? {})
    if (outcome === 'conflict') {
      // Someone edited the categories since they were read: decide again on what is there now.
      const fresh = await deps.getActivityData(user, activity.id)
      outcome = fresh ? await write(fresh) : 'unchanged'
      if (outcome === 'conflict') {
        auditWarn(user, 'deduction', `Rule could not update the run categories of activity ${activity.id}`, {
          rule_id: rule.id,
        })
      }
    }
    if (outcome === 'changed') changed.push(activity.id)
  }
  return changed
}

/**
 * The title step runs after the data enrichment, so it reads a field written in the same pass.
 * A dry run cannot see that data yet; it counts the largest of the steps, since the data
 * step only counts and the same activity is often in several.
 */
const enrich = async (
  user: string,
  rule: DeductionRule,
  matched: TimeRange[],
  window: EvaluationWindow,
  deps: DeductionEngineDeps,
  dryRun: boolean,
): Promise<EvaluateRuleResult> => {
  const dataFor = await buildMediaDataFor(user, rule, matched, window, deps)
  const titleField = rule.output_title_field
  const retitle = (dry: boolean) =>
    titleField
      ? deps.retitleActivities(user, rule.output_activity_type, matched, titleField, rule.id, dry)
      : Promise.resolve([])

  if (dryRun) {
    const enrichable = await countEnrichable(user, rule, matched, window, deps, dataFor)
    const retitled = (await retitle(true)).length
    const categorised = (await categorise(user, rule, matched, window, deps, true)).length
    return nothingAffected(Math.max(enrichable, retitled, categorised))
  }

  const enrichedIds = await deps.enrichActivities(
    user,
    rule.output_activity_type,
    matched,
    rule.output_data ?? {},
    rule.id,
    dataFor && rule.output_media_field
      ? { dataFor, overwriteKeys: [rule.output_media_field.field] }
      : undefined,
  )
  const retitledIds = await retitle(false)
  const categorisedIds = await categorise(user, rule, matched, window, deps, false)
  const affected = [...new Set([...enrichedIds, ...retitledIds, ...categorisedIds])]
  return allAffected(affected)
}

/**
 * When dryRun is true, returns the count of activities that would be affected without making changes.
 */
export const evaluateRule = async (
  user: string,
  rule: DeductionRule,
  window: EvaluationWindow,
  baseDeps: DeductionEngineDeps,
  dryRun = false,
): Promise<EvaluateRuleResult> => {
  const deps = withMemoizedMediaPlays(baseDeps)
  const result = await resolveConditions(user, rule, window, deps)
  // A categorising rule still runs on an empty match: it removes its category from the window.
  const categorising = rule.mode === 'enrich' && Boolean(rule.output_category)
  if (result.length === 0 && !categorising) return nothingAffected(0)

  if (rule.mode === 'retype') return retype(user, rule, result, window, deps, dryRun)

  if (rule.mode === 'enrich') return enrich(user, rule, result, window, deps, dryRun)

  // Create mode (default)
  if (dryRun) return nothingAffected(result.length)

  const createdIds: string[] = []
  let created = 0
  for (const range of result) {
    const id = randomUUID()
    // The insert upserts on (source, activity_type, start_time), so a re-evaluation
    // returns the id of the row that already exists there rather than the one
    // generated here. Keeping the generated id would make the stale cleanup below
    // delete the real activity on every other evaluation.
    const { id: insertedId, changed } = await deps.insertActivity(user, {
      activity_type: rule.output_activity_type,
      data: { rule_id: rule.id, rule_name: rule.name, ...rule.output_data },
      end_time: range.end,
      id,
      source: 'deduction-rule',
      start_time: range.start,
      title: rule.output_title ?? rule.name,
    })
    createdIds.push(insertedId ?? id)
    if (changed) created++
  }

  return { activities_created: created, affected_ids: createdIds, would_affect: createdIds.length }
}

/**
 * Rules at priority N complete before priority N+1 starts (for chaining).
 */
export const evaluateAllRules = async (
  user: string,
  rules: DeductionRule[],
  window: EvaluationWindow,
  deps: DeductionEngineDeps,
  dryRun = false,
): Promise<{ rules_evaluated: number; activities_created: number }> => {
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
      let outcome: EvaluateRuleResult
      try {
        outcome = await evaluateRule(user, rule, window, deps, dryRun)
      } catch (error) {
        // One broken rule must not keep the rules after it from running.
        auditError(user, 'deduction', `Rule "${rule.name}" failed to evaluate`, {
          error: error instanceof Error ? error.message : String(error),
          rule_id: rule.id,
        })
        totalRules++
        continue
      }
      const { activities_created, affected_ids, would_affect } = outcome

      if (!dryRun) {
        // Clean up stale activities from previous evaluations (only for create mode)
        if ((rule.mode ?? 'create') === 'create') {
          await deps.deleteStaleRuleActivities(user, rule.id, window.start, window.end, affected_ids)
        }

        const durationMs = Date.now() - startMs
        await deps.insertRuleRun(user, {
          activities_created,
          duration_ms: durationMs,
          rule_id: rule.id,
          window_end: window.end,
          window_start: window.start,
        })
      }

      totalActivities += dryRun ? would_affect : activities_created
      totalRules++
    }
  }

  return { activities_created: totalActivities, rules_evaluated: totalRules }
}

/**
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
