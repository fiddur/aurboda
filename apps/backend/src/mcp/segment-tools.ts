import {
  createSegmentBodySchema,
  segmentsQuerySchema,
  tzSchema,
  updateSegmentBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import { defaultSegmentOps, type SegmentOps } from '../services/segments.ts'
import { errorResponse, jsonResponse, type McpServer, tzJsonResponse } from './helpers.ts'

const segmentId = z.string().uuid().describe('Segment ID')

export const registerSegmentTools = (
  server: McpServer,
  user: string,
  ops: SegmentOps = defaultSegmentOps,
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
}
