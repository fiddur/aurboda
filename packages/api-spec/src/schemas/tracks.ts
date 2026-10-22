import { z } from 'zod'

import { createDataResponseSchema, latSchema, lonSchema } from './common.ts'

export const activityTrackPointSchema = z
  .object({
    alt: z.number().meta({ description: 'Altitude in metres (0 when the source has none)' }),
    lat: latSchema,
    lon: lonSchema,
    t: z.number().meta({ description: 'Seconds since the activity start' }),
  })
  .meta({
    description: 'One fix of an activity GPS track; t = seconds since the activity start',
    id: 'ActivityTrackPoint',
  })

export type ActivityTrackPoint = z.infer<typeof activityTrackPointSchema>

export const activityTrackSchema = z
  .object({
    activity_id: z.string().meta({ description: 'Activity ID' }),
    full_resolution: z.boolean().meta({
      description: 'False for a shape-only track (a Strava polyline backfill): its times are spread evenly',
    }),
    length_m: z.number().meta({ description: 'Track length in metres' }),
    point_count: z.number().int().meta({ description: 'Number of points in the track' }),
    points: z.array(activityTrackPointSchema),
    source: z.string().meta({ description: 'Source that recorded the track (garmin, strava)' }),
  })
  .meta({
    description:
      "An activity's GPS track at full resolution. When several sources recorded one, the full-resolution one with the most points.",
    id: 'ActivityTrack',
  })

export type ActivityTrack = z.infer<typeof activityTrackSchema>

export const activityTrackResponseSchema = createDataResponseSchema(activityTrackSchema).meta({
  id: 'ActivityTrackResponse',
})

export type ActivityTrackResponse = z.infer<typeof activityTrackResponseSchema>

export const trackBackfillResultSchema = z
  .object({
    garmin: z.number().int().meta({ description: 'Garmin tracks written from stored activity details' }),
    skipped: z.number().int().meta({ description: 'Candidates that yielded no usable track' }),
    strava: z.number().int().meta({ description: 'Strava shape-only tracks written from stored polylines' }),
  })
  .meta({
    description:
      'Counts from building missing activity tracks out of stored raw records (incremental: only activities without a track)',
    id: 'TrackBackfillResult',
  })

export type TrackBackfillResult = z.infer<typeof trackBackfillResultSchema>

export const trackBackfillResponseSchema = createDataResponseSchema(trackBackfillResultSchema).meta({
  id: 'TrackBackfillResponse',
})

export type TrackBackfillResponse = z.infer<typeof trackBackfillResponseSchema>
