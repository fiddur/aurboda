import { z } from 'zod'

import {
  createDataArrayResponseSchema,
  createDataResponseSchema,
  iso8601DateTimeSchema,
  latSchema,
  lonSchema,
} from './common.ts'

export const routePointSchema = z
  .object({ lat: latSchema, lon: lonSchema })
  .meta({ description: 'A point of a route line', id: 'RoutePoint' })

export type RoutePoint = z.infer<typeof routePointSchema>

export const routeSchema = z
  .object({
    activity_count: z.number().int().meta({
      description: 'Runs on the route (a run recorded by several sources counts once)',
    }),
    activity_type: z
      .string()
      .meta({ description: 'Activity type of the route: only activities of it match' }),
    canonical_activity_id: z.string().uuid().nullable().meta({
      description: 'The activity whose track is the route geometry (null once that activity is gone)',
    }),
    created_at: iso8601DateTimeSchema,
    end: routePointSchema.meta({ description: 'Where the route ends' }),
    id: z.string().uuid().meta({ description: 'Route ID' }),
    last_activity_at: iso8601DateTimeSchema.nullable().meta({ description: 'Start of the latest run' }),
    length_m: z.number().meta({ description: 'Route length in metres' }),
    name: z.string().meta({ description: 'Route name (auto-named from a nearby place and the length)' }),
    start: routePointSchema.meta({ description: 'Where the route starts' }),
    updated_at: iso8601DateTimeSchema,
  })
  .meta({
    description:
      'A recognised course: runs whose tracks cover each other (25 m buffer, 90 % both ways) in the same direction. Reverse direction is a different route.',
    id: 'Route',
  })

export type Route = z.infer<typeof routeSchema>

export const routeEffortSchema = z
  .object({
    activity_id: z.string().uuid().meta({ description: 'Activity ID' }),
    avg_hr: z.number().optional().meta({ description: 'Mean heart rate over the activity, bpm' }),
    coverage: z.number().meta({ description: 'Lower of the two buffer coverages when matched (0–1)' }),
    distance_m: z.number().optional().meta({ description: "The activity's recorded distance, metres" }),
    elapsed_s: z.number().meta({ description: 'Elapsed seconds (end − start)' }),
    end_time: iso8601DateTimeSchema.optional(),
    pace_s_per_km: z.number().optional().meta({
      description:
        'Seconds per km: from the mean speed samples, else elapsed time over the recorded distance',
    }),
    source: z.string().meta({ description: 'Source of the activity row' }),
    start_time: iso8601DateTimeSchema,
    title: z.string().optional(),
  })
  .meta({ description: 'One run of a route', id: 'RouteEffort' })

export type RouteEffort = z.infer<typeof routeEffortSchema>

export const routeDetailSchema = routeSchema
  .extend({
    efforts: z.array(routeEffortSchema).meta({ description: 'Runs on the route, newest first' }),
    points: z.array(routePointSchema).meta({ description: 'The route line (simplified, ~8 m)' }),
  })
  .meta({ description: 'A route with its line and its runs over time', id: 'RouteDetail' })

export type RouteDetail = z.infer<typeof routeDetailSchema>

export const routesResponseSchema = createDataArrayResponseSchema(routeSchema).meta({ id: 'RoutesResponse' })

export type RoutesResponse = z.infer<typeof routesResponseSchema>

export const routeResponseSchema = createDataResponseSchema(routeSchema).meta({ id: 'RouteResponse' })

export type RouteResponse = z.infer<typeof routeResponseSchema>

export const routeDetailResponseSchema = createDataResponseSchema(routeDetailSchema).meta({
  id: 'RouteDetailResponse',
})

export type RouteDetailResponse = z.infer<typeof routeDetailResponseSchema>

export const updateRouteBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255).meta({ description: 'New route name' }),
  })
  .meta({ description: 'Rename a route', id: 'UpdateRouteBody' })

export type UpdateRouteBody = z.infer<typeof updateRouteBodySchema>

export const mergeRoutesBodySchema = z
  .object({
    source_route_id: z.string().uuid().meta({
      description: 'Route whose runs move to this one; it is deleted afterwards',
    }),
  })
  .meta({ description: 'Merge another route into this one', id: 'MergeRoutesBody' })

export type MergeRoutesBody = z.infer<typeof mergeRoutesBodySchema>

export const mergeRoutesResultSchema = z
  .object({
    moved: z.number().int().meta({ description: 'Activities moved onto the target route' }),
    route: routeSchema,
  })
  .meta({ description: 'The merged route and how many activities moved onto it', id: 'MergeRoutesResult' })

export type MergeRoutesResult = z.infer<typeof mergeRoutesResultSchema>

export const mergeRoutesResponseSchema = createDataResponseSchema(mergeRoutesResultSchema).meta({
  id: 'MergeRoutesResponse',
})

export type MergeRoutesResponse = z.infer<typeof mergeRoutesResponseSchema>

export const routeMatchResultSchema = z
  .object({
    created: z.number().int().meta({ description: 'Routes created from pairs of matching tracks' }),
    matched: z.number().int().meta({ description: 'Activities attached to an existing route' }),
  })
  .meta({
    description: 'Counts from matching every tracked activity without a route (incremental, idempotent)',
    id: 'RouteMatchResult',
  })

export type RouteMatchResult = z.infer<typeof routeMatchResultSchema>

export const routeMatchResponseSchema = createDataResponseSchema(routeMatchResultSchema).meta({
  id: 'RouteMatchResponse',
})

export type RouteMatchResponse = z.infer<typeof routeMatchResponseSchema>

export const activityRouteSummarySchema = z
  .object({
    activity_count: z.number().int().meta({ description: 'Runs on the route' }),
    id: z.string().uuid().meta({ description: 'Route ID' }),
    name: z.string().meta({ description: 'Route name' }),
  })
  .meta({ description: 'The route an activity was matched to', id: 'ActivityRouteSummary' })

export type ActivityRouteSummary = z.infer<typeof activityRouteSummarySchema>
