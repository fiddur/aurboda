/** Media plays: MPRIS pushes unified with non-duplicate Last.fm scrobbles, computed at read time. */
import { z } from 'zod'

import { baseResponseSchema, createDataResponseSchema, iso8601DateTimeSchema } from './common.ts'

export const mediaPlaySourceSchema = z
  .enum(['mpris', 'lastfm'])
  .meta({ id: 'MediaPlaySource', description: 'Where the play came from' })

export type MediaPlaySource = z.infer<typeof mediaPlaySourceSchema>

export const mediaKindSchema = z
  .enum(['music', 'podcast', 'video'])
  .meta({ id: 'MediaKind', description: 'Kind of media, derived at read time' })

export type MediaKind = z.infer<typeof mediaKindSchema>

export const mediaPlaySchema = z
  .object({
    album: z.string(),
    artist: z.string(),
    device: z.string(),
    ended_at: iso8601DateTimeSchema.nullable().meta({ description: 'End of the play (null for Last.fm)' }),
    id: z.string().meta({ description: 'Client play id (mpris) or scrobble external id (lastfm)' }),
    kind: mediaKindSchema
      .nullable()
      .meta({ description: 'music for Last.fm plays; null (unknown) for MPRIS plays — classify with rules' }),
    max_position_secs: z.number().nullable(),
    played_ratio: z
      .number()
      .nullable()
      .meta({ description: 'played_secs / track_secs, null when either is unknown' }),
    played_secs: z.number().nullable().meta({ description: 'Seconds actually played (null for Last.fm)' }),
    player: z.string(),
    seek_count: z.number().int().nullable(),
    source: mediaPlaySourceSchema,
    started_at: iso8601DateTimeSchema,
    title: z.string(),
    track_secs: z.number().nullable().meta({ description: 'Track length in seconds, null when unknown' }),
    url: z.string(),
  })
  .meta({ id: 'MediaPlay', description: 'A media play (video, music, podcast) from MPRIS or Last.fm' })

export type MediaPlay = z.infer<typeof mediaPlaySchema>

export const mediaPlaysQuerySchema = z
  .object({
    end: iso8601DateTimeSchema.meta({ description: 'End of the window (exclusive)' }),
    start: iso8601DateTimeSchema.meta({ description: 'Start of the window (inclusive)' }),
  })
  .meta({ id: 'MediaPlaysQuery' })

export type MediaPlaysQuery = z.infer<typeof mediaPlaysQuerySchema>

export const mediaPlayQuerySchema = z
  .object({
    id: z.string().min(1).meta({ description: 'Play id; may contain "/" and other reserved characters' }),
  })
  .meta({ id: 'MediaPlayQuery' })

export type MediaPlayQuery = z.infer<typeof mediaPlayQuerySchema>

export const mediaPlaysResponseSchema = baseResponseSchema
  .extend({
    data: z
      .array(mediaPlaySchema)
      .optional()
      .meta({ description: 'Plays in the window, sorted by started_at' }),
  })
  .meta({ id: 'MediaPlaysResponse' })

export type MediaPlaysResponse = z.infer<typeof mediaPlaysResponseSchema>

export const mediaPlayResponseSchema = createDataResponseSchema(mediaPlaySchema).meta({
  id: 'MediaPlayResponse',
})

export type MediaPlayResponse = z.infer<typeof mediaPlayResponseSchema>
