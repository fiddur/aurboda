import {
  createSegmentBodySchema,
  promoteSuggestedSegmentBodySchema,
  segmentsQuerySchema,
  tzSchema,
  updateSegmentBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import { defaultSegmentOps, type SegmentOps } from '../services/segments.ts'
import { defaultSuggestedSegmentOps, type SuggestedSegmentOps } from '../services/suggested-segments.ts'
import { errorResponse, jsonResponse, type McpServer, tzJsonResponse } from './helpers.ts'

const segmentId = z.string().uuid().describe('Segment ID')
const suggestionId = z.string().uuid().describe('Suggested segment ID')
const SUGGESTION_NOT_FOUND = 'No pending suggested segment with this ID'

export const registerSegmentTools = (
  server: McpServer,
  user: string,
  ops: SegmentOps = defaultSegmentOps,
  suggestedOps: SuggestedSegmentOps = defaultSuggestedSegmentOps,
) => {
  server.tool(
    'list_segments',
    'Segments: stretches timed on every pass (directional, 25 m buffer, same activity type). Each has a name, activity type, length, effort count, best time and latest effort. activity_type keeps only segments of that type or its descendant types; sort orders by latest effort (last_effort, default), effort count (efforts), length or alphabetical by name.',
    { ...segmentsQuerySchema.shape, tz: tzSchema },
    async ({ activity_type, sort, tz }) =>
      tzJsonResponse({ data: await ops.list(user, { activity_type, sort }), success: true }, tz),
  )

  server.tool(
    'get_segment',
    'A segment with its line, the named locations within 500 m of its start and end (a segment near home would reveal it if shared), and its efforts, newest first: elapsed seconds, average heart rate, pace (s/km), whether it is approximate (timed on a shape-only track) and which is the best.',
    { id: segmentId, tz: tzSchema },
    async ({ id, tz }) => {
      const detail = await ops.detail(user, id)
      return detail ? tzJsonResponse({ data: detail, success: true }, tz) : errorResponse('Segment not found')
    },
  )

  server.tool(
    'create_segment',
    "Create a segment from part of an activity's GPS track (activity_id with start_offset_s and end_offset_s, seconds since the activity's start as get_activity_track's t) or of a route (route_id with start_km and end_km). It must be at least 100 m; without a name it is named after a named location near its start and its length. Every tracked activity of its type is timed on it at once.",
    { ...createSegmentBodySchema.shape },
    async (params) => {
      const parsed = createSegmentBodySchema.safeParse(params)
      if (!parsed.success) return errorResponse(parsed.error.issues.map((i) => i.message).join('; '))
      const result = await ops.create(user, parsed.data)
      return result.ok ? jsonResponse({ data: result.segment, success: true }) : errorResponse(result.error)
    },
  )

  server.tool(
    'update_segment',
    'Rename a segment.',
    { id: segmentId, ...updateSegmentBodySchema.shape },
    async ({ id, name }) => {
      const segment = await ops.rename(user, id, name)
      return segment ? jsonResponse({ data: segment, success: true }) : errorResponse('Segment not found')
    },
  )

  server.tool('delete_segment', 'Delete a segment and its efforts.', { id: segmentId }, async ({ id }) =>
    (await ops.remove(user, id)) ? jsonResponse({ success: true }) : errorResponse('Segment not found'),
  )

  server.tool(
    'match_segment',
    'Time every tracked activity of the segment type on it again, replacing its efforts; returns the counts. New tracks are timed automatically.',
    { id: segmentId },
    async ({ id }) => {
      const result = await ops.match(user, id)
      return result ? jsonResponse({ data: result, success: true }) : errorResponse('Segment not found')
    },
  )

  server.tool(
    'list_suggested_segments',
    'Suggested segments: stretches at least three activities of one type pass in the same direction (within 20 m, at least 400 m long), counted only across different routes so a shared hill shows up rather than every route. Each has its line, length, activity count and the named location near its start. Add one with promote_suggested_segment or dismiss it; scan_suggested_segments looks through activities not yet looked at.',
    { tz: tzSchema },
    async ({ tz }) => tzJsonResponse({ data: await suggestedOps.list(user), success: true }, tz),
  )

  server.tool(
    'promote_suggested_segment',
    'Add a suggested segment as a segment: the whole line, or trimmed to start_km–end_km along it, optionally named (else named after a nearby place and the length). Every tracked activity of its type is timed on it; the suggestion is not offered again.',
    { id: suggestionId, ...promoteSuggestedSegmentBodySchema.shape },
    async ({ id, ...body }) => {
      const parsed = promoteSuggestedSegmentBodySchema.safeParse(body)
      if (!parsed.success) return errorResponse(parsed.error.issues.map((i) => i.message).join('; '))
      const result = await suggestedOps.promote(user, id, parsed.data)
      if (!result) return errorResponse(SUGGESTION_NOT_FOUND)
      return result.ok ? jsonResponse({ data: result.segment, success: true }) : errorResponse(result.error)
    },
  )

  server.tool(
    'dismiss_suggested_segment',
    'Dismiss a suggested segment; the stretch is not suggested again.',
    { id: suggestionId },
    async ({ id }) =>
      (await suggestedOps.dismiss(user, id))
        ? jsonResponse({ success: true })
        : errorResponse(SUGGESTION_NOT_FOUND),
  )

  server.tool(
    'scan_suggested_segments',
    'Look through tracked activities not yet looked at for stretches passed often (new tracks are looked at automatically). Runs for up to about 20 seconds; call again while remaining > 0. Returns scanned, suggested (new suggestions) and remaining.',
    {},
    async () => jsonResponse({ data: await suggestedOps.scan(user), success: true }),
  )
}
