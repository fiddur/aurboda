import { z } from 'zod'

import { createDataArrayResponseSchema, createDataResponseSchema, iso8601DateTimeSchema } from './common.ts'
import { routePointSchema } from './routes.ts'

export const segmentSchema = z
  .object({
    activity_type: z
      .string()
      .meta({ description: 'Activity type of the segment: only activities of it match' }),
    best_elapsed_s: z.number().nullable().meta({
      description: 'Fastest effort in seconds (the fastest non-approximate one when there is any)',
    }),
    created_at: iso8601DateTimeSchema,
    effort_count: z.number().int().meta({
      description: 'Timed passes over the segment (a pass recorded by several sources counts once)',
    }),
    id: z.string().uuid().meta({ description: 'Segment ID' }),
    last_effort_at: iso8601DateTimeSchema.nullable().meta({ description: 'When the latest effort started' }),
    length_m: z.number().meta({ description: 'Segment length in metres' }),
    name: z.string().meta({ description: 'Segment name (auto-named from a nearby place and the length)' }),
    updated_at: iso8601DateTimeSchema,
  })
  .meta({
    description:
      'A stretch timed on every pass: a directional line, matched against tracks of its activity type (25 m buffer)',
    id: 'Segment',
  })

export type Segment = z.infer<typeof segmentSchema>

export const segmentEffortSchema = z
  .object({
    activity_id: z.string().uuid().meta({ description: 'Activity ID' }),
    activity_start_time: iso8601DateTimeSchema.meta({ description: "The activity's start time" }),
    approximate: z.boolean().meta({
      description: 'Timed on a shape-only track (evenly spread timestamps), so only roughly right',
    }),
    avg_hr: z.number().nullable().meta({ description: 'Mean heart rate during the effort, bpm' }),
    elapsed_s: z.number().meta({ description: 'Seconds from entering the segment to leaving it' }),
    is_best: z.boolean().meta({
      description:
        'The fastest effort (non-approximate first; the fastest of all when every one is approximate)',
    }),
    pace_s_per_km: z.number().meta({ description: 'Seconds per km over the segment' }),
    start_offset_s: z
      .number()
      .meta({ description: "Seconds from the activity's start to entering the segment" }),
  })
  .meta({ description: 'One timed pass over a segment', id: 'SegmentEffort' })

export type SegmentEffort = z.infer<typeof segmentEffortSchema>

export const segmentNearNamedLocationSchema = z
  .object({
    end: z.string().nullable().meta({ description: 'Named location within 500 m of the segment end' }),
    start: z.string().nullable().meta({ description: 'Named location within 500 m of the segment start' }),
  })
  .meta({
    description:
      'Named locations near the segment ends: a segment starting or ending near home would reveal it if shared',
    id: 'SegmentNearNamedLocation',
  })

export type SegmentNearNamedLocation = z.infer<typeof segmentNearNamedLocationSchema>

export const segmentDetailSchema = segmentSchema
  .extend({
    created_from_activity_id: z.string().uuid().nullable().meta({
      description: 'The activity the segment was cut from, if any',
    }),
    created_from_route_id: z.string().uuid().nullable().meta({
      description: 'The route the segment was cut from, if any',
    }),
    efforts: z.array(segmentEffortSchema).meta({ description: 'Efforts on the segment, newest first' }),
    near_named_location: segmentNearNamedLocationSchema,
    points: z.array(routePointSchema).meta({ description: 'The segment line, from start to end' }),
  })
  .meta({ description: 'A segment with its line and its efforts', id: 'SegmentDetail' })

export type SegmentDetail = z.infer<typeof segmentDetailSchema>

export const segmentSortOrders = ['last_effort', 'efforts', 'length', 'alphabetical'] as const

export const segmentSortSchema = z.enum(segmentSortOrders).meta({
  description:
    'Segment list order. last_effort: most recent effort first; efforts: most efforts first; length: longest first; alphabetical: by name',
  id: 'SegmentSort',
})

export type SegmentSort = z.infer<typeof segmentSortSchema>

export const segmentsQuerySchema = z
  .object({
    activity_type: z
      .string()
      .optional()
      .meta({ description: 'Only segments of this activity type or its descendant types' }),
    sort: segmentSortSchema.optional().default('last_effort').meta({
      description:
        'last_effort (default): most recent effort first; efforts: most efforts first; length: longest first; alphabetical: by name',
    }),
  })
  .meta({ description: 'Filter and order for the segment list', id: 'SegmentsQuery' })

export type SegmentsQuery = z.infer<typeof segmentsQuerySchema>

export const createSegmentBodySchema = z
  .object({
    activity_id: z.string().uuid().optional().meta({
      description: "Cut the segment from this activity's track (with start_offset_s and end_offset_s)",
    }),
    end_km: z
      .number()
      .nonnegative()
      .optional()
      .meta({ description: 'Where the segment ends on the route, km' }),
    end_offset_s: z.number().nonnegative().optional().meta({
      description: "Where the segment ends on the track: seconds since the activity's start (the track's t)",
    }),
    name: z.string().trim().min(1).max(255).optional().meta({
      description: 'Segment name; defaults to a nearby named place and the length',
    }),
    route_id: z.string().uuid().optional().meta({
      description: 'Cut the segment from this route (with start_km and end_km)',
    }),
    start_km: z
      .number()
      .nonnegative()
      .optional()
      .meta({ description: 'Where the segment starts on the route, km' }),
    start_offset_s: z.number().nonnegative().optional().meta({
      description:
        "Where the segment starts on the track: seconds since the activity's start (the track's t)",
    }),
  })
  .superRefine((body, ctx) => {
    const fromActivity = [body.activity_id, body.start_offset_s, body.end_offset_s]
    const fromRoute = [body.route_id, body.start_km, body.end_km]
    const activityGiven = fromActivity.some((v) => v !== undefined)
    const routeGiven = fromRoute.some((v) => v !== undefined)
    if (activityGiven === routeGiven) {
      ctx.addIssue({
        code: 'custom',
        message: 'Give either activity_id, start_offset_s and end_offset_s, or route_id, start_km and end_km',
      })
      return
    }
    const group = activityGiven ? fromActivity : fromRoute
    if (group.some((v) => v === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: activityGiven
          ? 'activity_id, start_offset_s and end_offset_s must be given together'
          : 'route_id, start_km and end_km must be given together',
      })
      return
    }
    const [, start, end] = group as [string, number, number]
    if (end <= start) {
      ctx.addIssue({
        code: 'custom',
        message: 'end must be after start',
        path: [activityGiven ? 'end_offset_s' : 'end_km'],
      })
    }
  })
  .meta({
    description:
      'Create a segment from part of an activity track (activity_id, start_offset_s, end_offset_s) or of a route (route_id, start_km, end_km). It is at least 100 m long, and every tracked activity of its type is timed on it at once.',
    id: 'CreateSegmentBody',
  })

export type CreateSegmentBody = z.infer<typeof createSegmentBodySchema>

export const updateSegmentBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255).meta({ description: 'New segment name' }),
  })
  .meta({ description: 'Rename a segment', id: 'UpdateSegmentBody' })

export type UpdateSegmentBody = z.infer<typeof updateSegmentBodySchema>

export const segmentMatchResultSchema = z
  .object({
    activities: z.number().int().meta({ description: 'Activities with at least one effort on the segment' }),
    efforts: z.number().int().meta({ description: 'Efforts written (every pass of every source)' }),
  })
  .meta({ description: 'Counts from timing every tracked activity on a segment', id: 'SegmentMatchResult' })

export type SegmentMatchResult = z.infer<typeof segmentMatchResultSchema>

export const activitySegmentEffortSchema = z
  .object({
    approximate: z.boolean().meta({ description: 'Timed on a shape-only track, so only roughly right' }),
    avg_hr: z.number().nullable().meta({ description: 'Mean heart rate during the effort, bpm' }),
    elapsed_s: z.number().meta({ description: 'Seconds from entering the segment to leaving it' }),
    is_best: z.boolean().meta({ description: "The segment's best effort" }),
    pace_s_per_km: z.number().meta({ description: 'Seconds per km over the segment' }),
    rank: z
      .number()
      .int()
      .meta({ description: "Position among the segment's efforts by elapsed time, 1 = fastest" }),
    segment_id: z.string().uuid().meta({ description: 'Segment ID' }),
    segment_name: z.string().meta({ description: 'Segment name' }),
    start_offset_s: z
      .number()
      .meta({ description: "Seconds from the activity's start to entering the segment" }),
  })
  .meta({ description: 'A timed pass of this activity over a segment', id: 'ActivitySegmentEffort' })

export type ActivitySegmentEffort = z.infer<typeof activitySegmentEffortSchema>

export const segmentsResponseSchema = createDataArrayResponseSchema(segmentSchema).meta({
  id: 'SegmentsResponse',
})

export type SegmentsResponse = z.infer<typeof segmentsResponseSchema>

export const segmentResponseSchema = createDataResponseSchema(segmentSchema).meta({ id: 'SegmentResponse' })

export type SegmentResponse = z.infer<typeof segmentResponseSchema>

export const segmentDetailResponseSchema = createDataResponseSchema(segmentDetailSchema).meta({
  id: 'SegmentDetailResponse',
})

export type SegmentDetailResponse = z.infer<typeof segmentDetailResponseSchema>

export const segmentMatchResponseSchema = createDataResponseSchema(segmentMatchResultSchema).meta({
  id: 'SegmentMatchResponse',
})

export type SegmentMatchResponse = z.infer<typeof segmentMatchResponseSchema>

export const suggestedSegmentSchema = z
  .object({
    activity_count: z.number().int().meta({
      description:
        'Activities that pass the stretch in the same direction (not counting runs of one route twice)',
    }),
    activity_type: z.string().meta({ description: 'Activity type of the activities that pass it' }),
    created_at: iso8601DateTimeSchema,
    id: z.string().uuid().meta({ description: 'Suggested segment ID' }),
    length_m: z.number().meta({ description: 'Length in metres' }),
    near_name: z
      .string()
      .nullable()
      .meta({ description: 'The named location within 500 m of its start, if any' }),
    points: z.array(routePointSchema).meta({ description: 'The suggested line, from start to end' }),
    source_activity_id: z.string().uuid().nullable().meta({
      description: 'The activity whose track the line was cut from',
    }),
  })
  .meta({
    description:
      'A stretch at least three activities of one type pass in the same direction, on different routes: offered as a segment to add or dismiss',
    id: 'SuggestedSegment',
  })

export type SuggestedSegment = z.infer<typeof suggestedSegmentSchema>

export const suggestedSegmentsResponseSchema = createDataArrayResponseSchema(suggestedSegmentSchema).meta({
  id: 'SuggestedSegmentsResponse',
})

export type SuggestedSegmentsResponse = z.infer<typeof suggestedSegmentsResponseSchema>

export const promoteSuggestedSegmentBodySchema = z
  .object({
    end_km: z
      .number()
      .nonnegative()
      .optional()
      .meta({ description: 'Trim: where the segment ends on the suggested line, km (with start_km)' }),
    name: z.string().trim().min(1).max(255).optional().meta({
      description: 'Segment name; defaults to a nearby named place and the length',
    }),
    start_km: z
      .number()
      .nonnegative()
      .optional()
      .meta({ description: 'Trim: where the segment starts on the suggested line, km (with end_km)' }),
  })
  .superRefine((body, ctx) => {
    if ((body.start_km === undefined) !== (body.end_km === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'start_km and end_km must be given together' })
      return
    }
    if (body.start_km !== undefined && body.end_km !== undefined && body.end_km <= body.start_km) {
      ctx.addIssue({ code: 'custom', message: 'end must be after start', path: ['end_km'] })
    }
  })
  .meta({
    description:
      'Add a suggested segment as a segment: the whole line, or the part between start_km and end_km, named or auto-named',
    id: 'PromoteSuggestedSegmentBody',
  })

export type PromoteSuggestedSegmentBody = z.infer<typeof promoteSuggestedSegmentBodySchema>

export const suggestedSegmentScanResultSchema = z
  .object({
    remaining: z.number().int().meta({ description: 'Tracked activities still to look through' }),
    scanned: z.number().int().meta({ description: 'Activities looked through in this run' }),
    suggested: z.number().int().meta({ description: 'New suggestions found' }),
  })
  .meta({
    description:
      'Counts from one run looking for stretches passed often (limited in time; run again while remaining > 0)',
    id: 'SuggestedSegmentScanResult',
  })

export type SuggestedSegmentScanResult = z.infer<typeof suggestedSegmentScanResultSchema>

export const suggestedSegmentScanResponseSchema = createDataResponseSchema(
  suggestedSegmentScanResultSchema,
).meta({ id: 'SuggestedSegmentScanResponse' })

export type SuggestedSegmentScanResponse = z.infer<typeof suggestedSegmentScanResponseSchema>
