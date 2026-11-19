import type {
  PromoteSuggestedSegmentBody,
  SuggestedSegment,
  SuggestedSegmentScanResult,
} from '@aurboda/api-spec'

import type { LatLon } from '../db/routes.ts'
import type { SegmentLineResult } from '../db/segments.ts'
import type {
  SuggestedSegmentRecord,
  SuggestionInput,
  UpsertSuggestionResult,
} from '../db/suggested-segments.ts'

import { findNearbyNamedLocation } from '../db/locations.ts'
import { deleteSegment } from '../db/segments.ts'
import {
  claimSuggestedSegment,
  countUnscannedTrackedActivities,
  decideSuggestedSegment,
  getSuggestionInput,
  listSuggestedSegments,
  listUnscannedTrackedActivities,
  markSuggestionsScanned,
  releaseStaleSuggestedSegmentClaims,
  settleSuggestedSegmentClaim,
  suggestedSegmentLine,
  upsertSuggestion,
} from '../db/suggested-segments.ts'
import { auditError, auditInfo } from './audit-log.ts'
import { haversineDistance } from './locations.ts'
import { cutLine, distinctSessions, sharedRuns, suggestStretches } from './segment-suggest.ts'
import {
  type CreateSegmentResult,
  createSegmentFromLine,
  defaultSegmentDeps,
  MIN_SEGMENT_END_GAP_M,
  type SegmentDeps,
} from './segments.ts'

const NAMING_RADIUS_M = 500
const SCAN_BATCH = 25
export const SCAN_BUDGET_MS = 20_000

export interface SuggestedSegmentDeps {
  getSuggestionInput: (user: string, activityId: string) => Promise<SuggestionInput | null>
  upsertSuggestion: (
    user: string,
    input: { activity_type: string; wkt: string; activity_count: number; source_activity_id: string },
  ) => Promise<UpsertSuggestionResult>
  markSuggestionsScanned: (user: string, activityId: string) => Promise<void>
  listUnscannedTrackedActivities: (user: string, limit: number) => Promise<{ activity_id: string }[]>
  countUnscannedTrackedActivities: (user: string) => Promise<number>
  listSuggestedSegments: (user: string) => Promise<SuggestedSegmentRecord[]>
  claimSuggestedSegment: (user: string, id: string) => Promise<SuggestedSegmentRecord | null>
  releaseStaleSuggestedSegmentClaims: (user: string) => Promise<void>
  settleSuggestedSegmentClaim: (user: string, id: string, segmentId: string | null) => Promise<void>
  suggestedSegmentLine: (
    user: string,
    id: string,
    startKm?: number,
    endKm?: number,
  ) => Promise<SegmentLineResult>
  decideSuggestedSegment: (
    user: string,
    id: string,
    status: 'dismissed' | 'promoted',
    segmentId?: string,
  ) => Promise<boolean>
  deleteSegment: (user: string, id: string) => Promise<boolean>
  findNearbyNamedLocation: SegmentDeps['findNearbyNamedLocation']
  now: () => number
  segment: SegmentDeps
}

export const defaultSuggestedSegmentDeps: SuggestedSegmentDeps = {
  claimSuggestedSegment,
  countUnscannedTrackedActivities,
  decideSuggestedSegment,
  deleteSegment,
  findNearbyNamedLocation,
  getSuggestionInput,
  listSuggestedSegments,
  listUnscannedTrackedActivities,
  markSuggestionsScanned,
  now: () => Date.now(),
  releaseStaleSuggestedSegmentClaims,
  segment: defaultSegmentDeps,
  settleSuggestedSegmentClaim,
  suggestedSegmentLine,
  upsertSuggestion,
}

export const lineWkt = (points: LatLon[]): string =>
  `LINESTRING(${points.map((p) => `${p.lon} ${p.lat}`).join(', ')})`

/**
 * Looks for stretches of the activity's track that at least two other activities (other
 * sessions, other routes) pass the same way, and stores each as a suggestion unless it is
 * already known. Idempotent; marks the activity as looked at.
 */
export const suggestSegmentsForActivity = async (
  user: string,
  activityId: string,
  deps: SuggestedSegmentDeps,
): Promise<{ suggested: number }> => {
  const input = await deps.getSuggestionInput(user, activityId)
  let suggested = 0
  if (input) {
    const intervals = distinctSessions(input.candidates).flatMap((candidate) =>
      sharedRuns(input.points, candidate.points).map((run) => ({
        ...run,
        activity_id: candidate.activity_id,
      })),
    )
    for (const stretch of suggestStretches(intervals)) {
      const line = cutLine(input.points, stretch.from_m, stretch.to_m)
      const start = line[0]
      const end = line.at(-1)
      if (!start || !end || line.length < 2) continue
      if (haversineDistance(start.lat, start.lon, end.lat, end.lon) < MIN_SEGMENT_END_GAP_M) continue
      const result = await deps.upsertSuggestion(user, {
        activity_count: stretch.activity_ids.length + 1,
        activity_type: input.activity_type,
        source_activity_id: activityId,
        wkt: lineWkt(line),
      })
      if (result === 'inserted') suggested++
    }
  }
  await deps.markSuggestionsScanned(user, activityId)
  return { suggested }
}

/**
 * Runs suggestion over the tracked activities not looked at yet, newest first, until none
 * are left or the time budget is used. A failure is audited and the activity still marked.
 */
export const scanSuggestedSegments = async (
  user: string,
  deps: SuggestedSegmentDeps,
  { budgetMs = SCAN_BUDGET_MS }: { budgetMs?: number } = {},
): Promise<SuggestedSegmentScanResult> => {
  const started = deps.now()
  const seen = new Set<string>()
  let scanned = 0
  let suggested = 0
  scan: while (deps.now() - started < budgetMs) {
    const batch = (await deps.listUnscannedTrackedActivities(user, SCAN_BATCH)).filter(
      (a) => !seen.has(a.activity_id),
    )
    if (batch.length === 0) break
    for (const { activity_id } of batch) {
      if (deps.now() - started >= budgetMs) break scan
      seen.add(activity_id)
      try {
        suggested += (await suggestSegmentsForActivity(user, activity_id, deps)).suggested
      } catch (error) {
        auditError(user, 'data', 'Segment suggestion failed', { activity_id, error: String(error) })
        try {
          await deps.markSuggestionsScanned(user, activity_id)
        } catch {
          // Already audited; the seen set keeps this run from retrying it.
        }
      }
      scanned++
    }
  }
  const remaining = await deps.countUnscannedTrackedActivities(user)
  if (suggested > 0) auditInfo(user, 'data', '📍 Segments suggested', { scanned, suggested })
  return { remaining, scanned, suggested }
}

export const serializeSuggestedSegment = (
  record: SuggestedSegmentRecord,
  nearName: string | null,
): SuggestedSegment => ({
  activity_count: record.activity_count,
  activity_type: record.activity_type,
  created_at: record.created_at.toISOString(),
  id: record.id,
  length_m: record.length_m,
  near_name: nearName,
  points: record.points,
  source_activity_id: record.source_activity_id,
})

export const listSuggestedSegmentsWithNames = async (
  user: string,
  deps: SuggestedSegmentDeps,
): Promise<SuggestedSegment[]> => {
  await deps.releaseStaleSuggestedSegmentClaims(user)
  const records = await deps.listSuggestedSegments(user)
  return Promise.all(
    records.map(async (record) => {
      const start = record.points[0]
      const near = start
        ? await deps.findNearbyNamedLocation(user, start.lat, start.lon, NAMING_RADIUS_M)
        : null
      return serializeSuggestedSegment(record, near?.name ?? null)
    }),
  )
}

const createFromSuggestion = async (
  user: string,
  suggestion: SuggestedSegmentRecord,
  body: PromoteSuggestedSegmentBody,
  deps: SuggestedSegmentDeps,
): Promise<CreateSegmentResult | null> => {
  const result = await deps.suggestedSegmentLine(user, suggestion.id, body.start_km, body.end_km)
  if (!result.ok) {
    return result.reason === 'not_found'
      ? null
      : { error: 'start_km and end_km must lie within the suggested segment', ok: false }
  }
  return createSegmentFromLine(
    user,
    result.line,
    {
      name: body.name,
      ...(suggestion.source_activity_id ? { created_from_activity_id: suggestion.source_activity_id } : {}),
    },
    deps.segment,
  )
}

/**
 * Adds a pending suggestion as a segment (trimmed when start_km and end_km are given), exactly
 * as creating one from a line does. The suggestion is claimed first, so a second promote of it
 * finds nothing pending, and made pending again when no segment came of it or linking it to
 * its segment failed. Null when there is no pending suggestion with this id.
 */
export const promoteSuggestedSegment = async (
  user: string,
  id: string,
  body: PromoteSuggestedSegmentBody,
  deps: SuggestedSegmentDeps,
): Promise<CreateSegmentResult | null> => {
  await deps.releaseStaleSuggestedSegmentClaims(user)
  const suggestion = await deps.claimSuggestedSegment(user, id)
  if (!suggestion) return null
  let created: CreateSegmentResult | null
  try {
    created = await createFromSuggestion(user, suggestion, body, deps)
  } catch (error) {
    await deps.settleSuggestedSegmentClaim(user, id, null)
    throw error
  }
  const segmentId = created?.ok ? created.segment.id : null
  try {
    await deps.settleSuggestedSegmentClaim(user, id, segmentId)
  } catch (error) {
    // A failed release is left to releaseStaleSuggestedSegmentClaims; the first error is the one to report.
    if (segmentId) {
      await deps.deleteSegment(user, segmentId).catch(() => undefined)
      await deps.settleSuggestedSegmentClaim(user, id, null).catch(() => undefined)
    }
    throw error
  }
  return created
}

export const dismissSuggestedSegment = (
  user: string,
  id: string,
  deps: SuggestedSegmentDeps,
): Promise<boolean> => deps.decideSuggestedSegment(user, id, 'dismissed')

export interface SuggestedSegmentOps {
  list: (user: string) => Promise<SuggestedSegment[]>
  promote: (
    user: string,
    id: string,
    body: PromoteSuggestedSegmentBody,
  ) => Promise<CreateSegmentResult | null>
  dismiss: (user: string, id: string) => Promise<boolean>
  scan: (user: string) => Promise<SuggestedSegmentScanResult>
}

export const createSuggestedSegmentOps = (deps: SuggestedSegmentDeps): SuggestedSegmentOps => ({
  dismiss: (user, id) => dismissSuggestedSegment(user, id, deps),
  list: (user) => listSuggestedSegmentsWithNames(user, deps),
  promote: (user, id, body) => promoteSuggestedSegment(user, id, body, deps),
  scan: (user) => scanSuggestedSegments(user, deps),
})

export const defaultSuggestedSegmentOps = createSuggestedSegmentOps(defaultSuggestedSegmentDeps)
