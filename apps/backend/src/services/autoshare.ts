/**
 * Auto-share rule evaluation: when activities in a mutation window have
 * SETTLED (every merge-group member ingested at least
 * {@link STABILISATION_SECONDS} ago and, for a Garmin-backed group, its detail
 * synced or {@link DETAIL_WAIT_SECONDS} passed; unsettled groups re-queue the
 * window), publish the ones matching an enabled rule to the federated feed —
 * exactly as a manual share with the rule's template would.
 *
 * Safety properties, in order of importance:
 * - **Hard dedupe**: at most one post per activity/merge-group EVER. The whole
 *   group's ids are checked against existing feed posts (manual or auto) AND
 *   against the deletion suppressions (`deleteFeedPost` records the activity id
 *   before hard-deleting the post row), so a re-sync, merge, or edit can never
 *   double-post, a manually-shared activity is never auto-shared, and a share
 *   the user deleted never comes back.
 * - **No retroactive sharing**: a rule only matches when BOTH the anchor row
 *   was INGESTED after the rule was (last) enabled AND the activity itself
 *   ENDED after the enable. The ingest gate makes enabling affect new arrivals
 *   only; the activity-time gate keeps a first sync / full re-sync of a newly
 *   connected source (which ingests months of history as fresh rows) from
 *   mass-publishing that history. A delayed sync of a workout done after
 *   enabling still shares — the case that matters.
 * - **Bounded blast radius**: at most {@link MAX_POSTS_PER_RUN} posts per
 *   evaluation run — federated deliveries can't be recalled, so even a bug or
 *   an unexpectedly wide window can only leak a handful of posts, visibly
 *   logged, never a firehose.
 * - **Merge-group aware**: matching and the created post both use the group's
 *   ANCHOR (earliest start) and its merged span — the same window a manual
 *   share of the merged activity uses.
 *
 * Dependencies are injected so the whole decision tree is unit-testable
 * without a database; `createAutoshareDeps` wires the real ones.
 */
import type { AutoshareDataFilter } from '@aurboda/api-spec'

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
  /** The merge group's combined data ({@link groupData}). */
  data: Record<string, unknown>
}

const isBlank = (value: unknown): boolean =>
  value == null || (typeof value === 'string' && value.trim() === '')

const filterHolds = (filter: AutoshareDataFilter, data: Record<string, unknown>): boolean => {
  const value = data[filter.field]
  const equal = (): boolean => !isBlank(value) && String(value).trim() === String(filter.value).trim()
  switch (filter.operator) {
    case 'eq':
      return equal()
    case 'exists':
      return !isBlank(value)
    case 'neq':
      return !equal()
    case 'not_exists':
      return isBlank(value)
  }
}

/** Every filter holds, with a blank value (null, missing, whitespace-only string) counting as missing. */
export const dataFiltersMatch = (filters: AutoshareDataFilter[], data: Record<string, unknown>): boolean =>
  filters.every((filter) => filterHolds(filter, data))

/**
 * The data a merge group shares as one: each key takes the first non-blank value
 * walking the members anchor first — an edit of a synced activity can land on an
 * override row, which then carries the field the anchor lacks. A member replaced by
 * another member (the synced row behind an edit's override) contributes nothing, so
 * its stale value can never outrank the edit.
 */
export const groupData = (group: AutoshareCandidate[]): Record<string, unknown> => {
  const ids = new Set(group.map((member) => member.id))
  const combined: Record<string, unknown> = {}
  for (const member of group) {
    if (member.superseded_by != null && ids.has(member.superseded_by)) continue
    for (const [key, value] of Object.entries(member.data ?? {})) {
      if (isBlank(combined[key]) && !isBlank(value)) combined[key] = value
    }
  }
  return combined
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
  return dataFiltersMatch(rule.data_filters, subject.data)
}

/** Whether any rule needs the (comparatively expensive) distance resolution. */
const needsDistance = (rules: AutoshareRuleRecord[]): boolean =>
  rules.some((rule) => rule.min_distance_meters != null)

/**
 * `Member` is what `getGroup` hands back and the anchor-taking deps receive, so
 * the production wiring can carry the activity row it already fetched through
 * to `resolveWindow` and `onCreated` instead of looking it up again.
 */
export interface AutoshareDeps<Member extends AutoshareCandidate = AutoshareCandidate> {
  getEnabledRules: (user: string) => Promise<AutoshareRuleRecord[]>
  /** Settled (bounded, non-deleted) activities overlapping the window, ended no earlier than `endedAfter`. */
  listCandidates: (user: string, start: Date, end: Date, endedAfter?: Date) => Promise<AutoshareCandidate[]>
  /** The candidate's whole merge group, earliest-start first (its anchor at [0]). */
  getGroup: (user: string, candidate: AutoshareCandidate) => Promise<Member[]>
  /** The anchor's merged-span window (what a manual share of it would cover). */
  resolveWindow: (user: string, anchor: Member) => Promise<ResolvedFeedActivity>
  /** Existing feed posts referencing any of the given activity ids. */
  postIdsForActivities: (user: string, activityIds: string[]) => Promise<string[]>
  /** Activities whose post the user DELETED (never republish; survives the hard delete). */
  suppressedActivityIds: (user: string, activityIds: string[]) => Promise<string[]>
  /** Total distance (meters) over a window, or undefined when none recorded. */
  distanceMeters: (user: string, start: Date, end: Date) => Promise<number | undefined>
  /** Create the feed post from the rule's template (the shared manual-share path). */
  createPost: (user: string, anchor: Member, rule: AutoshareRuleRecord) => Promise<FeedPostRecord>
  /** Fan the created post out to followers (fire-and-forget, like a manual share). */
  onCreated: (user: string, post: FeedPostRecord, anchor: Member) => void
  /** Evaluate the window again no sooner than `notBefore` (some group in it was not settled yet). */
  requeue?: (user: string, start: Date, end: Date, notBefore: Date) => Promise<void>
}

export type AutosharePreviewDeps<Member extends AutoshareCandidate = AutoshareCandidate> = Pick<
  AutoshareDeps<Member>,
  'listCandidates' | 'getGroup' | 'resolveWindow' | 'distanceMeters'
>

/**
 * How long after its newest member was ingested a merge group counts as
 * settled. Health Connect pushes roughly once a minute, so a window delay alone
 * never ages anything: some job always matures within the next minute.
 */
export const STABILISATION_SECONDS = 10 * 60

/**
 * How long a Garmin-backed group waits for its detail sync (GPS, per-second HR,
 * distance) before it is shared as is.
 */
export const DETAIL_WAIT_SECONDS = 2 * 3600

/** When an unsettled group should be looked at again, or null when it is ready now. */
export const groupNotBefore = (
  group: AutoshareCandidate[],
  anchor: AutoshareCandidate,
  now: Date,
): Date | null => {
  const youngest = Math.max(...group.map((member) => member.created_at.getTime()))
  const settledAt = youngest + STABILISATION_SECONDS * 1000
  if (settledAt > now.getTime()) return new Date(settledAt)
  const detailPending = group.some((member) => member.detail_pending)
  if (detailPending && now.getTime() - anchor.created_at.getTime() < DETAIL_WAIT_SECONDS * 1000) {
    return new Date(now.getTime() + STABILISATION_SECONDS * 1000)
  }
  return null
}

/**
 * Cap on posts created per evaluation run. Deliveries can't be recalled, so a
 * surprisingly wide window (first sync of a new source, a manual full re-sync)
 * must never turn into a firehose; the skip is logged. Groups beyond the cap
 * that STILL match on a later window share then — but the activity-time gate
 * already keeps genuinely old history out entirely.
 */
export const MAX_POSTS_PER_RUN = 5

/**
 * Evaluate one settled mutation window. Returns how many posts were created.
 * Idempotent: re-running over the same window creates nothing new (dedupe).
 */
// eslint-disable-next-line complexity -- the guard ladder IS the feature; each step is one safety property
export const evaluateAutoshareWindow = async <Member extends AutoshareCandidate>(
  user: string,
  start: Date,
  end: Date,
  deps: AutoshareDeps<Member>,
  now: Date = new Date(),
): Promise<number> => {
  const rules = await deps.getEnabledRules(user)
  const enableTimes = rules.flatMap((rule) => (rule.enabled_at == null ? [] : [rule.enabled_at.getTime()]))
  if (enableTimes.length === 0) return 0

  const candidates = await deps.listCandidates(user, start, end, new Date(Math.min(...enableTimes)))
  if (candidates.length === 0) return 0

  const processedAnchors = new Set<string>()
  let created = 0
  let requeueAt: Date | null = null
  for (const candidate of candidates) {
    // An empty group means the candidate vanished since listing (deleted) — skip.
    const group = await deps.getGroup(user, candidate)
    const anchor = group[0]
    if (anchor == null) continue
    if (processedAnchors.has(anchor.id)) continue
    processedAnchors.add(anchor.id)

    // New-arrivals-only, gate 1: the anchor row was ingested after the enable.
    // Checked before the settling wait, or a backfilled group that can never
    // share would re-queue the window until its detail-sync wait ran out.
    const ingestEligible = rules.filter(
      (rule) => rule.enabled_at != null && anchor.created_at.getTime() >= rule.enabled_at.getTime(),
    )
    if (ingestEligible.length === 0) continue

    // Hard dedupe: any existing post referencing ANY group member — or a
    // deletion suppression for one — blocks the group forever.
    const groupIds = group.map((a) => a.id)
    const [existing, suppressed] = await Promise.all([
      deps.postIdsForActivities(user, groupIds),
      deps.suppressedActivityIds(user, groupIds),
    ])
    if (existing.length > 0 || suppressed.length > 0) continue

    const notBefore = groupNotBefore(group, anchor, now)
    if (notBefore != null) {
      if (requeueAt == null || notBefore < requeueAt) requeueAt = notBefore
      continue
    }

    const window = await deps.resolveWindow(user, anchor)
    if (window.end_time == null) continue
    const windowEnd = window.end_time

    // New-arrivals-only, gate 2: the activity itself ended after the enable —
    // a first sync/backfill ingests months of history as FRESH rows, which
    // passes gate 1; this keeps that history off the feed. A delayed sync of a
    // workout done after enabling still shares.
    const eligibleRules = ingestEligible.filter(
      (rule) => rule.enabled_at != null && windowEnd.getTime() >= rule.enabled_at.getTime(),
    )
    if (eligibleRules.length === 0) continue

    const durationSeconds = Math.round((windowEnd.getTime() - window.start_time.getTime()) / 1000)
    const distance = needsDistance(eligibleRules)
      ? await deps.distanceMeters(user, window.start_time, windowEnd)
      : undefined

    const subject: AutoshareSubject = {
      activityType: anchor.activity_type,
      data: groupData(group),
      distanceMeters: distance,
      durationSeconds,
      source: anchor.source,
    }
    const rule = eligibleRules.find((candidateRule) => activityMatchesRule(candidateRule, subject))
    if (!rule) continue

    const post = await deps.createPost(user, anchor, rule)
    deps.onCreated(user, post, anchor)
    created++
    if (created >= MAX_POSTS_PER_RUN) {
      console.warn(
        `⚠️ auto-share cap: created ${created} posts for ${user} in one run; skipping the rest of the window`,
      )
      break
    }
  }
  if (requeueAt != null) await deps.requeue?.(user, start, end, requeueAt)
  return created
}

export const PREVIEW_SAMPLE_DAYS = 30

/**
 * Preview: how many merge groups in the last `sampleDays` WOULD match the
 * rule's predicate — regardless of shared status or `enabled_at` (the point is
 * to show the rule's reach before enabling it). Creates nothing.
 */
export const previewAutoshareRule = async <Member extends AutoshareCandidate>(
  user: string,
  rule: AutoshareRuleRecord,
  deps: AutosharePreviewDeps<Member>,
  now: Date,
  sampleDays: number = PREVIEW_SAMPLE_DAYS,
): Promise<number> => {
  const start = new Date(now.getTime() - sampleDays * 86_400_000)
  const candidates = await deps.listCandidates(user, start, now)
  const processedAnchors = new Set<string>()
  let matched = 0
  for (const candidate of candidates) {
    // A merge group is same-type, so the candidate's type is its anchor's.
    if (rule.activity_types.length > 0 && !rule.activity_types.includes(candidate.activity_type)) continue
    const group = await deps.getGroup(user, candidate)
    const anchor = group[0]
    if (anchor == null) continue
    if (processedAnchors.has(anchor.id)) continue
    processedAnchors.add(anchor.id)

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
      data: groupData(group),
      distanceMeters: distance,
      durationSeconds,
      source: anchor.source,
    }
    if (activityMatchesRule(rule, subject)) matched++
  }
  return matched
}
