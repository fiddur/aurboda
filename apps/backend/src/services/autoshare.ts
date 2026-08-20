/**
 * Auto-share rule evaluation (#903): when activities in a mutation window have
 * SETTLED (the queue delays evaluation past the merge/enrich/re-sync churn),
 * publish the ones matching an enabled rule to the federated feed — exactly as
 * a manual share with the rule's template would.
 *
 * Safety properties, in order of importance:
 * - **Hard dedupe**: at most one post per activity/merge-group EVER. The whole
 *   group's ids are checked against existing feed posts (manual or auto), so a
 *   re-sync, merge, or edit can never double-post, and a manually-shared
 *   activity is never auto-shared.
 * - **No retroactive sharing**: a rule only matches activities whose row was
 *   INGESTED after the rule was (last) enabled (`enabled_at` vs the anchor's
 *   `created_at`) — enabling a rule affects new arrivals only.
 * - **Merge-group aware**: matching and the created post both use the group's
 *   ANCHOR (earliest start) and its merged span — the same window a manual
 *   share of the merged activity uses.
 *
 * Dependencies are injected so the whole decision tree is unit-testable
 * without a database; `createAutoshareDeps` wires the real ones.
 */
import type { AutoshareCandidate, AutoshareRuleRecord, FeedPostRecord } from '../db/index.ts'
import type { ResolvedFeedActivity } from './feed.ts'

/** What the predicate is evaluated against: the settled merge-group anchor. */
export interface AutoshareSubject {
  activityType: string
  source: string | null
  /** Merged-span duration. */
  durationSeconds: number
  /** Total distance over the merged span, or undefined when unknown/absent. */
  distanceMeters: number | undefined
}

/** Pure predicate: does a settled activity match a rule? */
export const activityMatchesRule = (rule: AutoshareRuleRecord, subject: AutoshareSubject): boolean => {
  if (rule.activity_types.length > 0 && !rule.activity_types.includes(subject.activityType)) return false
  if (rule.source != null && rule.source !== subject.source) return false
  if (rule.min_duration_seconds != null && subject.durationSeconds < rule.min_duration_seconds) return false
  if (rule.max_duration_seconds != null && subject.durationSeconds > rule.max_duration_seconds) return false
  if (rule.min_distance_meters != null) {
    if (subject.distanceMeters === undefined) return false
    if (subject.distanceMeters < rule.min_distance_meters) return false
  }
  return true
}

/** Whether any rule needs the (comparatively expensive) distance resolution. */
const needsDistance = (rules: AutoshareRuleRecord[]): boolean =>
  rules.some((rule) => rule.min_distance_meters != null)

export interface AutoshareDeps {
  getEnabledRules: (user: string) => Promise<AutoshareRuleRecord[]>
  /** Settled (bounded, non-deleted) activities overlapping the window. */
  listCandidates: (user: string, start: Date, end: Date) => Promise<AutoshareCandidate[]>
  /** The candidate's whole merge group, earliest-start first (its anchor at [0]). */
  getGroup: (user: string, candidate: AutoshareCandidate) => Promise<AutoshareCandidate[]>
  /** The anchor's merged-span window (what a manual share of it would cover). */
  resolveWindow: (user: string, anchor: AutoshareCandidate) => Promise<ResolvedFeedActivity>
  /** Existing feed posts referencing any of the given activity ids. */
  postIdsForActivities: (user: string, activityIds: string[]) => Promise<string[]>
  /** Total distance (meters) over a window, or undefined when none recorded. */
  distanceMeters: (user: string, start: Date, end: Date) => Promise<number | undefined>
  /** Create the feed post from the rule's template (the shared manual-share path). */
  createPost: (user: string, anchor: AutoshareCandidate, rule: AutoshareRuleRecord) => Promise<FeedPostRecord>
  /** Fan the created post out to followers (fire-and-forget, like a manual share). */
  onCreated: (user: string, post: FeedPostRecord, anchor: AutoshareCandidate) => void
}

/**
 * Evaluate one settled mutation window. Returns how many posts were created.
 * Idempotent: re-running over the same window creates nothing new (dedupe).
 */
// eslint-disable-next-line complexity -- the guard ladder IS the feature; each step is one safety property
export const evaluateAutoshareWindow = async (
  user: string,
  start: Date,
  end: Date,
  deps: AutoshareDeps,
): Promise<number> => {
  const rules = await deps.getEnabledRules(user)
  if (rules.length === 0) return 0

  const candidates = await deps.listCandidates(user, start, end)
  if (candidates.length === 0) return 0

  const processedAnchors = new Set<string>()
  let created = 0
  for (const candidate of candidates) {
    // An empty group means the candidate vanished since listing (deleted) — skip.
    const group = await deps.getGroup(user, candidate)
    const anchor = group[0]
    if (anchor == null) continue
    if (processedAnchors.has(anchor.id)) continue
    processedAnchors.add(anchor.id)

    // Hard dedupe: any existing post referencing ANY group member blocks the group forever.
    const existing = await deps.postIdsForActivities(
      user,
      group.map((a) => a.id),
    )
    if (existing.length > 0) continue

    // New-arrivals-only: the anchor row must have been ingested after the enable.
    const eligibleRules = rules.filter(
      (rule) => rule.enabled_at != null && anchor.created_at.getTime() >= rule.enabled_at.getTime(),
    )
    if (eligibleRules.length === 0) continue

    const window = await deps.resolveWindow(user, anchor)
    if (window.end_time == null) continue
    const durationSeconds = Math.round((window.end_time.getTime() - window.start_time.getTime()) / 1000)
    const distance = needsDistance(eligibleRules)
      ? await deps.distanceMeters(user, window.start_time, window.end_time)
      : undefined

    const subject: AutoshareSubject = {
      activityType: anchor.activity_type,
      distanceMeters: distance,
      durationSeconds,
      source: anchor.source,
    }
    const rule = eligibleRules.find((candidateRule) => activityMatchesRule(candidateRule, subject))
    if (!rule) continue

    const post = await deps.createPost(user, anchor, rule)
    deps.onCreated(user, post, anchor)
    created++
  }
  return created
}

/** How far back the preview samples. */
export const PREVIEW_SAMPLE_DAYS = 30

/**
 * Preview: how many merge groups in the last `sampleDays` WOULD match the
 * rule's predicate — regardless of shared status or `enabled_at` (the point is
 * to show the rule's reach before enabling it). Creates nothing.
 */
export const previewAutoshareRule = async (
  user: string,
  rule: AutoshareRuleRecord,
  deps: Pick<AutoshareDeps, 'listCandidates' | 'getGroup' | 'resolveWindow' | 'distanceMeters'>,
  now: Date,
  sampleDays: number = PREVIEW_SAMPLE_DAYS,
): Promise<number> => {
  const start = new Date(now.getTime() - sampleDays * 86_400_000)
  const candidates = await deps.listCandidates(user, start, now)
  const processedAnchors = new Set<string>()
  let matched = 0
  for (const candidate of candidates) {
    const group = await deps.getGroup(user, candidate)
    const anchor = group[0]
    if (anchor == null) continue
    if (processedAnchors.has(anchor.id)) continue
    processedAnchors.add(anchor.id)

    // Cheap pre-filters before resolving windows/distance.
    if (rule.activity_types.length > 0 && !rule.activity_types.includes(anchor.activity_type)) continue
    if (rule.source != null && rule.source !== anchor.source) continue

    const window = await deps.resolveWindow(user, anchor)
    if (window.end_time == null) continue
    const durationSeconds = Math.round((window.end_time.getTime() - window.start_time.getTime()) / 1000)
    const distance =
      rule.min_distance_meters != null
        ? await deps.distanceMeters(user, window.start_time, window.end_time)
        : undefined
    const subject: AutoshareSubject = {
      activityType: anchor.activity_type,
      distanceMeters: distance,
      durationSeconds,
      source: anchor.source,
    }
    if (activityMatchesRule(rule, subject)) matched++
  }
  return matched
}
