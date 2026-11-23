import { z } from 'zod'

import { baseResponseSchema } from './common.ts'

export const dataKindIds = [
  'location',
  'sleep',
  'heart_rate',
  'steps',
  'workouts',
  'strength_sets',
  'readiness',
  'body',
  'computer_screen_time',
  'phone_screen_time',
  'music',
  'calendar',
  'own_logging',
] as const

export const dataKindIdSchema = z.enum(dataKindIds).meta({
  description: 'A kind of data a source brings in, as the Data sources page lists them',
  id: 'DataKindId',
})

export type DataKindId = z.infer<typeof dataKindIdSchema>

export interface DataKindInfo {
  id: DataKindId
  label: string
  one_source_enough: boolean
  overlap_hint?: string
}

export const dataKinds: readonly DataKindInfo[] = [
  { id: 'location', label: 'Location', one_source_enough: true, overlap_hint: "your phone's position" },
  { id: 'sleep', label: 'Sleep', one_source_enough: false },
  { id: 'heart_rate', label: 'Heart rate and HRV', one_source_enough: false },
  { id: 'steps', label: 'Steps and daily activity', one_source_enough: false },
  { id: 'workouts', label: 'Workouts', one_source_enough: false },
  { id: 'strength_sets', label: 'Strength sets', one_source_enough: false },
  { id: 'readiness', label: 'Readiness and stress', one_source_enough: false },
  { id: 'body', label: 'Body measurements', one_source_enough: false },
  {
    id: 'computer_screen_time',
    label: 'Screen time on a computer',
    one_source_enough: true,
    overlap_hint: "your computer's app usage",
  },
  { id: 'phone_screen_time', label: 'Screen time on a phone', one_source_enough: false },
  { id: 'music', label: 'Music', one_source_enough: false },
  { id: 'calendar', label: 'Calendar', one_source_enough: false },
  { id: 'own_logging', label: 'Your own logging', one_source_enough: false },
]

export const dataSourceIds = [
  'aurboda',
  'android_app',
  'oura',
  'garmin',
  'strava',
  'gravl',
  'activitywatch_desktop',
  'activitywatch_android',
  'rescuetime',
  'lastfm',
  'owntracks',
  'home_assistant',
  'calendars',
] as const

export const dataSourceIdSchema = z.enum(dataSourceIds).meta({
  description: 'A data source the user can connect, as the Data sources page lists them',
  id: 'DataSourceId',
})

export type DataSourceId = z.infer<typeof dataSourceIdSchema>

export const dataSourceGroupIds = [
  'health',
  'workouts',
  'location',
  'screen_time',
  'music',
  'calendar',
  'own',
] as const

export const dataSourceGroupIdSchema = z.enum(dataSourceGroupIds).meta({
  description: 'The heading a data source is listed under on the Data sources page',
  id: 'DataSourceGroupId',
})

export type DataSourceGroupId = z.infer<typeof dataSourceGroupIdSchema>

export interface DataSourceGroupInfo {
  id: DataSourceGroupId
  label: string
}

export const dataSourceGroups: readonly DataSourceGroupInfo[] = [
  { id: 'health', label: 'Health and sleep' },
  { id: 'workouts', label: 'Workouts' },
  { id: 'location', label: 'Location' },
  { id: 'screen_time', label: 'Screen time' },
  { id: 'music', label: 'Music' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'own', label: 'Your own logging' },
]

export interface ConnectableSource {
  id: DataSourceId
  name: string
  path: string
  group: DataSourceGroupId
  kinds: readonly DataKindId[]
}

export const connectableSources: readonly ConnectableSource[] = [
  {
    group: 'own',
    id: 'aurboda',
    kinds: ['own_logging'],
    name: 'Aurboda (Web / API / MCP)',
    path: '/data-sources/aurboda',
  },
  {
    group: 'health',
    id: 'android_app',
    kinds: ['sleep', 'heart_rate', 'steps', 'workouts', 'body'],
    name: 'Aurboda Android',
    path: '/data-sources/android-app',
  },
  {
    group: 'health',
    id: 'oura',
    kinds: ['sleep', 'heart_rate', 'readiness', 'steps'],
    name: 'Oura Ring',
    path: '/data-sources/oura',
  },
  {
    group: 'health',
    id: 'garmin',
    kinds: ['sleep', 'heart_rate', 'steps', 'workouts', 'strength_sets', 'readiness', 'body'],
    name: 'Garmin',
    path: '/data-sources/garmin',
  },
  { group: 'workouts', id: 'strava', kinds: ['workouts'], name: 'Strava', path: '/data-sources/strava' },
  { group: 'workouts', id: 'gravl', kinds: ['strength_sets'], name: 'Gravl', path: '/data-sources/gravl' },
  {
    group: 'screen_time',
    id: 'activitywatch_desktop',
    kinds: ['computer_screen_time'],
    name: 'ActivityWatch (Desktop)',
    path: '/data-sources/activitywatch-desktop',
  },
  {
    group: 'screen_time',
    id: 'activitywatch_android',
    kinds: ['phone_screen_time'],
    name: 'ActivityWatch (Android)',
    path: '/data-sources/activitywatch-android',
  },
  {
    group: 'screen_time',
    id: 'rescuetime',
    kinds: ['computer_screen_time'],
    name: 'RescueTime',
    path: '/data-sources/rescue-time',
  },
  { group: 'music', id: 'lastfm', kinds: ['music'], name: 'Last.fm', path: '/data-sources/lastfm' },
  {
    group: 'location',
    id: 'owntracks',
    kinds: ['location'],
    name: 'OwnTracks',
    path: '/data-sources/owntracks',
  },
  {
    group: 'location',
    id: 'home_assistant',
    kinds: ['location'],
    name: 'Home Assistant',
    path: '/data-sources/home-assistant',
  },
  {
    group: 'calendar',
    id: 'calendars',
    kinds: ['calendar'],
    name: 'Calendars (ICS)',
    path: '/data-sources/calendars',
  },
]

export const dataSourceStatusSchema = z.enum(['active', 'configured', 'not_set_up']).meta({
  description:
    'active: connected or delivering data; configured: set up, but nothing received recently; not_set_up: neither',
  id: 'DataSourceStatus',
})

export type DataSourceStatus = z.infer<typeof dataSourceStatusSchema>

export const dataSourceOverviewItemSchema = z
  .object({
    detail: z.string().meta({
      description: 'The status line shown on the source card',
      example: 'Data received in the last 7 days',
    }),
    group: dataSourceGroupIdSchema,
    id: dataSourceIdSchema,
    kinds: z.array(dataKindIdSchema).meta({ description: 'The kinds of data this source brings in' }),
    name: z.string().meta({ example: 'OwnTracks' }),
    path: z.string().meta({ description: "The web path of the source's setup page" }),
    status: dataSourceStatusSchema,
  })
  .meta({ description: 'One connectable data source and whether it is set up', id: 'DataSourceOverviewItem' })

export type DataSourceOverviewItem = z.infer<typeof dataSourceOverviewItemSchema>

export const dataKindOverviewSchema = z
  .object({
    active_sources: z
      .array(dataSourceIdSchema)
      .meta({ description: 'The active sources bringing this kind of data, in catalogue order' }),
    available_sources: z
      .array(dataSourceIdSchema)
      .meta({ description: 'Every source that can bring this kind of data, in catalogue order' }),
    id: dataKindIdSchema,
    label: z.string().meta({ example: 'Location' }),
    one_source_enough: z.boolean().meta({
      description: 'Whether two sources of this kind send the same data, so one of them is superfluous',
    }),
    overlap: z.boolean().meta({
      description: 'True when one source is enough for this kind and two or more of them are active',
    }),
    overlap_hint: z.string().nullable().meta({
      description: 'What two sources of this kind both send, for the overlap message',
      example: "your phone's position",
    }),
  })
  .meta({ description: 'One kind of data and the sources that bring it', id: 'DataKindOverview' })

export type DataKindOverview = z.infer<typeof dataKindOverviewSchema>

export const dataSourceGroupSchema = z
  .object({ id: dataSourceGroupIdSchema, label: z.string() })
  .meta({ id: 'DataSourceGroup' })

export const dataSourcesOverviewSchema = z
  .object({
    groups: z.array(dataSourceGroupSchema).meta({ description: 'The source headings, in display order' }),
    kinds: z.array(dataKindOverviewSchema).meta({ description: 'Every kind of data, in display order' }),
    sources: z.array(dataSourceOverviewItemSchema).meta({ description: 'Every connectable source' }),
  })
  .meta({
    description:
      'Which data sources are connected, the kinds of data each brings, which sources feed each kind, and where two sources send the same thing',
    id: 'DataSourcesOverview',
  })

export type DataSourcesOverview = z.infer<typeof dataSourcesOverviewSchema>

export const dataSourcesOverviewResponseSchema = baseResponseSchema
  .extend(dataSourcesOverviewSchema.shape)
  .meta({ id: 'DataSourcesOverviewResponse' })

export type DataSourcesOverviewResponse = z.infer<typeof dataSourcesOverviewResponseSchema>
