import { z } from 'zod'

import { defaultFeedTags, maxPostTags } from '../hashtags.ts'
import { baseResponseSchema, dateOnlySchema, hrZoneSourceSchema, iso8601DateTimeSchema } from './common.ts'
import { dashboardConfigSchema } from './dashboard.ts'
import { hashtagInputSchema } from './feed.ts'
import { goalsSchema } from './goals.ts'
import { journalContextItemsSchema } from './journal-context.ts'
import { displayNameInputSchema } from './profile.ts'
import { reportImportMappingSchema } from './reports.ts'
import { defaultSleepNeedMinutes, sleepNeedMinutesSchema } from './sleep.ts'
import { garminDataTypeSchema } from './sync.ts'
import { ianaTimezoneSchema } from './timezone.ts'
import { trainingLoadSettingsSchema } from './training-load.ts'

const hrZoneThresholdSchema = z.number().int().positive()

export const hrZoneThresholdsSchema = z
  .object({
    1: hrZoneThresholdSchema.meta({ description: 'Zone 1 threshold (bpm)', example: 90 }),
    2: hrZoneThresholdSchema.meta({ description: 'Zone 2 threshold (bpm)', example: 108 }),
    3: hrZoneThresholdSchema.meta({ description: 'Zone 3 threshold (bpm)', example: 126 }),
    4: hrZoneThresholdSchema.meta({ description: 'Zone 4 threshold (bpm)', example: 144 }),
    5: hrZoneThresholdSchema.meta({ description: 'Zone 5 threshold (bpm)', example: 162 }),
  })
  .refine((data) => data[1] < data[2] && data[2] < data[3] && data[3] < data[4] && data[4] < data[5], {
    message: 'HR zone thresholds must be in ascending order',
  })
  .meta({ id: 'HrZoneThresholds' })

export type HrZoneThresholds = z.infer<typeof hrZoneThresholdsSchema>

export const biologicalSexSchema = z.enum(['male', 'female']).meta({
  description: 'Biological sex (used for calorie calculation formulas)',
  example: 'male',
  id: 'BiologicalSex',
})

export type BiologicalSex = z.infer<typeof biologicalSexSchema>

export const birthDateSchema = z.iso.date().meta({
  description: 'Birth date in YYYY-MM-DD format',
  example: '1985-06-15',
})

export const rescueTimeKeySchema = z.string().min(1, 'RescueTime API key cannot be empty').meta({
  description: 'RescueTime API key (personal token)',
})

export const gravlApiTokenSchema = z.string().min(1, 'Gravl API token cannot be empty').meta({
  description: 'Gravl personal access token (gat_…), used when no OAuth grant exists',
})

export const homeAssistantUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        const url = new URL(value)
        return (
          (url.protocol === 'http:' || url.protocol === 'https:') &&
          url.username === '' &&
          url.password === '' &&
          url.search === '' &&
          url.hash === ''
        )
      } catch {
        return false
      }
    },
    { message: 'Home Assistant URL must be an http(s) URL without credentials, query or fragment' },
  )
  .meta({
    description: 'Base URL of the Home Assistant server, as reachable from the Aurboda server',
    example: 'https://ha.example.org',
  })

export const homeAssistantTokenSchema = z.string().min(1, 'Home Assistant token cannot be empty').meta({
  description: 'Home Assistant long-lived access token',
})

export const homeAssistantEntityIdSchema = z
  .string()
  .regex(/^(device_tracker|person)\.[a-z0-9_]+$/, 'Must be a device_tracker.* or person.* entity id')
  .meta({
    description: 'Home Assistant entity that carries the phone position (device_tracker.* or person.*)',
    example: 'device_tracker.pixel_8',
  })

export const syncIntervalsSchema = z
  .record(
    z.string().meta({
      description:
        'Provider name (gravl, garmin, oura, rescuetime, lastfm, calendar, home_assistant, weather) or "default"',
    }),
    z.number().int().min(5).max(1440).meta({ description: 'Poll interval in minutes (5–1440)' }),
  )
  .meta({
    id: 'SyncIntervals',
    description:
      'How often the background scheduler polls each pull-based provider, in minutes. Keyed by provider name; the "default" key applies to providers without their own entry. Providers not listed fall back to the server default.',
  })

export type SyncIntervals = z.infer<typeof syncIntervalsSchema>

export const lastFmUsernameSchema = z.string().min(1, 'Last.fm username cannot be empty').meta({
  description: 'Last.fm username for scrobble sync',
})

export const tagMappingsSchema = z.record(z.string(), z.string()).meta({
  description: 'Tag mappings from Oura tag_type_code UUIDs to display names',
  id: 'TagMappings',
})

/** @deprecated Use itemIconsSchema instead. */
export const tagIconsSchema = z.record(z.string(), z.string()).meta({
  description: 'Tag icon mappings (tag key or display name -> emoji character or image URL)',
  id: 'TagIcons',
})

/**
 * Keys use a prefix convention:
 * - Tag names or tag_keys: "Coffee", "meditation" (no prefix, backwards-compatible with tag_icons)
 * - Activity types: "activity:sleep", "activity:nap", "activity:meditation"
 * - Exercise types: "exercise:Running", "exercise:Biking", etc.
 * - Screentime categories: "category:Work", "category:Work > Programming"
 *
 * Values are emoji characters or image URLs. An empty string explicitly clears the default icon.
 */
export const itemIconsSchema = z.record(z.string(), z.string()).meta({
  description:
    'Unified icon mappings for all timeline items (tags, activities, exercise types, screentime categories). Keys use prefix convention: activity:sleep, exercise:Running, category:Work > Programming, or plain tag names.',
  id: 'ItemIcons',
})

export const calendarConfigSchema = z
  .object({
    name: z.string().min(1).meta({ description: 'Display name for the calendar' }),
    url: z.string().url().meta({ description: 'ICS URL for the calendar' }),
  })
  .meta({ id: 'CalendarConfig' })

export type CalendarConfig = z.infer<typeof calendarConfigSchema>

export const calendarsSchema = z.array(calendarConfigSchema).meta({
  description: 'Calendar ICS URL configurations',
  id: 'Calendars',
})

export type TagMappings = z.infer<typeof tagMappingsSchema>

export const mealSlotSchema = z
  .object({
    default_hour: z.number().int().min(0).max(23).meta({ description: 'Default hour of day (0-23)' }),
    name: z.string().min(1).meta({ description: 'Meal slot name (e.g., "Breakfast", "Lunch")' }),
  })
  .meta({ id: 'MealSlot', description: 'A configured meal slot for quick-logging' })

export type MealSlot = z.infer<typeof mealSlotSchema>

export const mealSlotsSchema = z.array(mealSlotSchema).meta({
  id: 'MealSlots',
  description: 'Configured meal slots for quick-logging',
})

export const sensitivityAreasSchema = z.array(z.string().min(1)).meta({
  id: 'SensitivityAreas',
  description: 'Sensitivity areas to track in meals (e.g., "gluten", "dairy", "red_meat")',
})

/**
 * Maps exact food item names to sensitivity areas they contain.
 * E.g., { "Toasted rye bread": ["gluten"], "Milk": ["dairy"] }
 */
export const foodSensitivityMapSchema = z.record(z.string(), z.array(z.string())).meta({
  id: 'FoodSensitivityMap',
  description: 'Mapping from food item names to sensitivity areas they contain',
})

const mafHrSchema = z.number().int().min(80).max(220)

export const onboardingStepIds = ['android_app', 'wearable', 'computer_time', 'social', 'ask_ai'] as const

export const onboardingStepIdSchema = z.enum(onboardingStepIds).meta({
  description: 'A step of the dashboard "Get started" guide',
  id: 'OnboardingStepId',
})

export type OnboardingStepId = z.infer<typeof onboardingStepIdSchema>

export const timelineDailyMetrics = [
  'resting_heart_rate',
  'sleep_duration',
  'hrv_rmssd',
  'steps',
  'weight',
] as const

export const timelineDailyMetricSchema = z.enum(timelineDailyMetrics).meta({
  description:
    'A daily metric the Timeline can draw as its own track at week and month spans; sleep_duration is the sleep that ends on each day, the rest are metric names',
  id: 'TimelineDailyMetric',
})

export type TimelineDailyMetric = z.infer<typeof timelineDailyMetricSchema>

export const defaultTimelineDailyMetrics: TimelineDailyMetric[] = ['resting_heart_rate']

const timelineDailyMetricsSchema = z
  .array(timelineDailyMetricSchema)
  .max(timelineDailyMetrics.length)
  .refine((names) => new Set(names).size === names.length, {
    message: 'Timeline daily metrics must not repeat',
  })

export const maxHiddenPages = 200

export const hiddenPagesSchema = z
  .array(
    z.string().startsWith('/', 'A hidden page is a menu path starting with /').max(200).meta({
      description: 'A menu path, e.g. /meals',
      example: '/meals',
    }),
  )
  .max(maxHiddenPages)
  .meta({
    description:
      "Menu paths the user hid from the menus (web sidebar and phone menu, the Android app's More tab and bottom bar). Hiding only removes the menu link: the page, its data and the API stay. Home, Settings, Help, Notifications and the admin pages are always shown, whatever the list says; unknown paths are kept.",
    id: 'HiddenPages',
  })

export const updateSettingsInputSchema = z
  .object({
    birth_date: birthDateSchema.nullable().optional().meta({
      description: 'Birth date (set to null to clear)',
    }),
    calendars: calendarsSchema.nullable().optional().meta({
      description: 'Calendar ICS URL configurations (set to null to clear all)',
    }),
    dashboard: dashboardConfigSchema.nullable().optional().meta({
      description: 'Dashboard configuration (set to null to reset to defaults)',
    }),
    display_name: displayNameInputSchema.nullable().optional().meta({
      description:
        'Name shown on your profile and posts, in the feed and to followers on other servers (at most 100 characters, no control or bidirectional formatting characters; null or an empty string for none, which shows your username)',
    }),
    goals: goalsSchema.nullable().optional().meta({
      description: 'Goals (set to null to reset to defaults, empty array to clear all)',
    }),
    hidden_pages: hiddenPagesSchema.nullable().optional().meta({
      description:
        'Menu paths to leave out of the menus, e.g. ["/meals", "/strength"]; the whole list is replaced (set to null or [] to show every page again)',
    }),
    hr_zone_start: hrZoneThresholdsSchema.nullable().optional().meta({
      description: 'Custom HR zone thresholds (set to null to clear)',
    }),
    item_icons: itemIconsSchema.nullable().optional().meta({
      description:
        'Unified icon mappings for all timeline items — tags, activities, exercise types (set to null to clear all)',
    }),
    feed_default_tags: z.array(hashtagInputSchema).max(maxPostTags).nullable().optional().meta({
      description:
        'Hashtags every feed post gets automatically, e.g. `["aurboda"]` (stored lowercase without `#`; empty for none; set to null to reset to `["aurboda"]`)',
    }),
    feed_type_tag: z.boolean().nullable().optional().meta({
      description:
        "Whether a shared activity also gets its type as a hashtag (e.g. `#running`), an exercise share the exercise's name and a challenge share `#challenge` (set to null to reset to the default, true)",
    }),
    food_sensitivity_map: foodSensitivityMapSchema.nullable().optional().meta({
      description: 'Food-to-sensitivity mapping (set to null to clear)',
    }),
    meal_slots: mealSlotsSchema.nullable().optional().meta({
      description: 'Configured meal slots for quick-logging (set to null to clear)',
    }),
    journal_context: journalContextItemsSchema.nullable().optional().meta({
      description:
        'The journal context line: the figures shown under a journal entry for its day, in order; the whole list is replaced (set to null to reset to the default, none)',
    }),
    journal_strip_metadata: z.boolean().nullable().optional().meta({
      description:
        'Remove the metadata (such as when and where a picture was taken) from pictures added to the Journal from now on. Recordings are always stored as they are. Default false: pictures keep it (set to null to reset to the default).',
    }),
    lastfm_username: lastFmUsernameSchema.nullable().optional().meta({
      description: 'Last.fm username for scrobble sync (set to null to clear)',
    }),
    maf_hr: mafHrSchema.nullable().optional().meta({
      description:
        'Low-HR / MAF ceiling in bpm (180 − age with the Maffetone adjustments). When unset the zone-2 upper bound is used (set to null to clear)',
    }),
    manually_approve_followers: z.boolean().nullable().optional().meta({
      description:
        'When true, incoming follows are held as pending requests you approve or reject; when false (default), anyone can follow you automatically (set to null to reset to the default).',
    }),
    onboarding_dismissed_at: iso8601DateTimeSchema.nullable().optional().meta({
      description:
        'When the dashboard "Get started" guide was hidden; the guide stays hidden while set (set to null to show it again)',
    }),
    onboarding_manual_done: z.array(onboardingStepIdSchema).nullable().optional().meta({
      description:
        'Get-started steps the user marked as done by hand, for steps Aurboda cannot detect by itself (set to null to clear)',
    }),
    report_import_mapping: reportImportMappingSchema.nullable().optional().meta({
      description:
        'The column mapping the lab report import remembers from the last import (set to null to forget it)',
    }),
    rescue_time_key: rescueTimeKeySchema.nullable().optional().meta({
      description: 'RescueTime API key (set to null to clear)',
    }),
    sensitivity_areas: sensitivityAreasSchema.nullable().optional().meta({
      description: 'Sensitivity areas to track in meals (set to null to clear)',
    }),
    sex: biologicalSexSchema.nullable().optional().meta({
      description: 'Biological sex for calorie calculation (set to null to clear)',
    }),
    sleep_need_minutes: sleepNeedMinutesSchema.nullable().optional().meta({
      description:
        'How much sleep you need per night, in minutes (180–720); sleep debt is judged against it (set to null to reset to the default, 480)',
    }),
    tag_icons: tagIconsSchema.nullable().optional().meta({
      description: 'Tag icon mappings (deprecated, use item_icons instead; set to null to clear all)',
    }),
    tag_mappings: tagMappingsSchema.nullable().optional().meta({
      description: 'Tag name mappings (set to null to clear all)',
    }),
    timeline_show_replies: z.boolean().nullable().optional().meta({
      description:
        "When true, followed actors' replies show as their own home-timeline cards whatever they answer; when false (default), replies to posts that aren't in your timeline are hidden — replies to your own posts, posts mentioning you, and replies within a thread you already see always appear (set to null to reset to the default).",
    }),
    timeline_daily_metrics: timelineDailyMetricsSchema.nullable().optional().meta({
      description:
        'Daily metrics the Timeline draws as tracks under its Metrics lane when it shows more than three days (set to null to reset to the default, resting_heart_rate)',
    }),
    training_load: trainingLoadSettingsSchema.nullable().optional().meta({
      description: 'Training load (Banister model) parameters (set to null to reset to defaults)',
    }),
    tz: ianaTimezoneSchema.nullable().optional().meta({
      description:
        "Time zone (IANA, e.g. Europe/Stockholm) that reminders and daily figures follow. Setting it without tz_follows_device also turns tz_follows_device off, so the Android app no longer replaces it with the phone's zone (set to null to clear, which means UTC, and to follow the phone again)",
    }),
    tz_follows_device: z.boolean().nullable().optional().meta({
      description:
        "When true (the default), the Android app's sync sets tz from the phone; when false, the phone's zone is ignored and tz stays as set (set to null to reset to the default, true)",
    }),
    garmin_disabled_data_types: z.array(garminDataTypeSchema).nullable().optional().meta({
      description: 'Garmin data types to skip during sync (set to null to clear, enabling all)',
    }),
    gravl_api_token: gravlApiTokenSchema.nullable().optional().meta({
      description:
        'Gravl personal access token (set to null to clear). Ignored for sync while an OAuth grant exists.',
    }),
    sync_intervals: syncIntervalsSchema.nullable().optional().meta({
      description:
        'Background sync poll intervals in minutes per provider (set to null to reset to server defaults)',
    }),
    home_assistant_url: homeAssistantUrlSchema.nullable().optional().meta({
      description: 'Home Assistant base URL, as reachable from the Aurboda server (set to null to clear)',
    }),
    home_assistant_token: homeAssistantTokenSchema.nullable().optional().meta({
      description:
        'Home Assistant long-lived access token (set to null to clear). Write-only: never returned by the settings API. Cleared when home_assistant_url moves to another origin without a new token in the same update.',
    }),
    home_assistant_entity_id: homeAssistantEntityIdSchema.nullable().optional().meta({
      description:
        'Home Assistant device_tracker.* or person.* entity to pull locations from (set to null to clear)',
    }),
    weather_enabled: z.boolean().nullable().optional().meta({
      description:
        'Fetch the hourly weather where you were from Open-Meteo, sending only your coordinates rounded to 0.1° (about 11 km). Default false: nothing is fetched (set to null to reset to the default).',
    }),
  })
  .meta({ id: 'UpdateSettingsInput' })

export type UpdateSettingsInput = z.infer<typeof updateSettingsInputSchema>

export const garminPersonalKeyStatusSchema = z
  .object({
    available: z.boolean().meta({
      description: 'Whether this server lets users connect a Garmin Personal API key (admin setting)',
    }),
    connected: z.boolean().meta({ description: 'Whether a Garmin Personal API key is stored' }),
    expires_at: dateOnlySchema.nullable().meta({
      description: 'The expiry date entered with the key, or null when no key is stored',
    }),
    refused: z.boolean().meta({ description: 'Whether Garmin refused the stored key (it needs replacing)' }),
  })
  .meta({ description: 'Status of the Garmin Personal API key connection', id: 'GarminPersonalKeyStatus' })

export type GarminPersonalKeyStatus = z.infer<typeof garminPersonalKeyStatusSchema>

export const garminOAuthStatusSchema = z
  .object({
    available: z.boolean().meta({
      description:
        'Whether this server has Garmin Connect Developer Program credentials (Connect with Garmin)',
    }),
    connected: z.boolean().meta({ description: 'Whether Garmin is connected through Connect with Garmin' }),
    delivers: z.array(garminDataTypeSchema).meta({
      description:
        'The data types Connect with Garmin delivers right now; the automatic sync leaves them to it and fetches the rest through the login or key',
    }),
    last_received_at: iso8601DateTimeSchema.nullable().meta({
      description: 'When Garmin last pushed data for this user, or null when nothing has arrived yet',
    }),
    needs_reconnect: z.boolean().meta({
      description: 'Whether Garmin refused to renew the connection, so the user has to connect again',
    }),
    permissions: z.array(z.string()).meta({
      description:
        'What the user shares with Aurboda, as Garmin reports it (HEALTH_EXPORT, ACTIVITY_EXPORT, ...)',
    }),
  })
  .meta({ description: 'Status of the Connect with Garmin (OAuth) connection', id: 'GarminOAuthStatus' })

export type GarminOAuthStatus = z.infer<typeof garminOAuthStatusSchema>

export const garminDataSourceSchema = z.enum(['push', 'session', 'personal_key']).meta({
  description:
    'The connection a Garmin data type comes through: push (Connect with Garmin delivers it), session (fetched through the Garmin login) or personal_key (fetched with the Personal API key)',
  id: 'GarminDataSource',
})

export type GarminDataSource = z.infer<typeof garminDataSourceSchema>

export const garminDataSourcesSchema = z.partialRecord(garminDataTypeSchema, garminDataSourceSchema).meta({
  description:
    'For each Garmin data type, the connection it comes through right now; a type no connection brings is left out',
  id: 'GarminDataSources',
})

export type GarminDataSources = z.infer<typeof garminDataSourcesSchema>

export const userSettingsResponseSchema = baseResponseSchema
  .extend({
    birth_date: z.string().nullable().default(null).meta({ description: 'Birth date in YYYY-MM-DD format' }),
    calendars: calendarsSchema.default([]).meta({ description: 'Calendar ICS URL configurations' }),
    dashboard: dashboardConfigSchema
      .nullable()
      .default(null)
      .meta({ description: 'Custom dashboard configuration (null = use default)' }),
    display_name: z.string().nullable().default(null).meta({
      description:
        'Name shown on your profile and posts, in the feed and to followers on other servers; null for none (your username is shown)',
    }),
    feed_default_tags: z
      .array(z.string())
      .default([...defaultFeedTags])
      .meta({ description: 'Hashtags every feed post gets automatically (lowercase, without `#`)' }),
    feed_type_tag: z.boolean().default(true).meta({
      description:
        "Whether a shared activity also gets its type as a hashtag (an exercise share the exercise's name, a challenge share `#challenge`)",
    }),
    food_sensitivity_map: foodSensitivityMapSchema
      .default({})
      .meta({ description: 'Food-to-sensitivity mapping' }),
    garmin_connected: z.boolean().default(false).meta({
      description: 'Whether Garmin is connected, by login session, Personal API key or Connect with Garmin',
    }),
    garmin_session_connected: z
      .boolean()
      .default(false)
      .meta({ description: 'Whether Garmin is connected by a Garmin Connect login session' }),
    garmin_personal_key: garminPersonalKeyStatusSchema.default({
      available: true,
      connected: false,
      expires_at: null,
      refused: false,
    }),
    garmin_oauth: garminOAuthStatusSchema.default({
      available: false,
      connected: false,
      delivers: [],
      last_received_at: null,
      needs_reconnect: false,
      permissions: [],
    }),
    garmin_disabled_data_types: z
      .array(garminDataTypeSchema)
      .default([])
      .meta({ description: 'Garmin data types currently disabled for sync' }),
    garmin_data_sources: garminDataSourcesSchema.default({}),
    goals: goalsSchema.meta({ description: 'User goals for tracking metrics' }),
    hidden_pages: hiddenPagesSchema.default([]).meta({
      description:
        'Menu paths hidden from the menus (empty = every page shows); Home, Settings, Help, Notifications and the admin pages always show',
    }),
    hr_zone_start: hrZoneThresholdsSchema.meta({ description: 'Effective HR zone thresholds' }),
    hr_zone_start_source: hrZoneSourceSchema.default('default').meta({
      description: 'Source of HR zone thresholds',
    }),
    item_icons: itemIconsSchema.default({}).meta({
      description:
        'Unified icon mappings for all timeline items — tags, activities, exercise types (tag key or name -> emoji/URL)',
    }),
    journal_context: journalContextItemsSchema.default([]).meta({
      description: 'The journal context line: the figures shown under a journal entry for its day, in order',
    }),
    journal_strip_metadata: z.boolean().default(false).meta({
      description:
        'Remove the metadata (such as when and where a picture was taken) from pictures added to the Journal from now on. Recordings are always stored as they are.',
    }),
    lastfm_configured: z
      .boolean()
      .default(false)
      .meta({ description: 'Whether Last.fm API key is configured on server' }),
    lastfm_username: z
      .string()
      .nullable()
      .default(null)
      .meta({ description: 'Last.fm username for scrobble sync' }),
    maf_hr: mafHrSchema.nullable().default(null).meta({
      description: 'Low-HR / MAF ceiling in bpm; null when unset (the zone-2 upper bound is used)',
    }),
    manually_approve_followers: z.boolean().default(false).meta({
      description: 'Whether incoming follows are held for manual approval (locked account)',
    }),
    meal_slots: mealSlotsSchema.default([]).meta({ description: 'Configured meal slots for quick-logging' }),
    onboarding_dismissed_at: z.string().nullable().default(null).meta({
      description: 'When the dashboard "Get started" guide was hidden (ISO 8601), or null while it shows',
    }),
    onboarding_manual_done: z.array(onboardingStepIdSchema).default([]).meta({
      description: 'Get-started steps the user marked as done by hand',
    }),
    oura_configured: z
      .boolean()
      .default(false)
      .meta({ description: 'Whether Oura OAuth is configured on server' }),
    oura_connected: z.boolean().default(false).meta({ description: 'Whether Oura is connected via OAuth' }),
    gravl_configured: z.boolean().default(false).meta({
      description: 'Whether a Gravl OAuth app is configured on the server (enables "Connect Gravl")',
    }),
    gravl_connection: z.enum(['oauth', 'token']).nullable().default(null).meta({
      description: 'How Gravl is connected: an OAuth grant, a personal token, or null when not connected',
    }),
    home_assistant_url: z.string().nullable().default(null).meta({ description: 'Home Assistant base URL' }),
    home_assistant_entity_id: z
      .string()
      .nullable()
      .default(null)
      .meta({ description: 'Home Assistant entity locations are pulled from' }),
    home_assistant_token_set: z.boolean().default(false).meta({
      description:
        'Whether a Home Assistant access token is stored (the settings API never returns the token itself)',
    }),
    report_import_mapping: reportImportMappingSchema.nullable().default(null).meta({
      description:
        'The column mapping of the last spreadsheet import of lab reports, to start the next one from (null before the first)',
    }),
    rescue_time_key: z.string().nullable().default(null).meta({ description: 'RescueTime API key' }),
    strava_connected: z
      .boolean()
      .default(false)
      .meta({ description: 'Whether Strava is connected via OAuth' }),
    strava_configured: z
      .boolean()
      .default(false)
      .meta({ description: 'Whether Strava OAuth is configured on server' }),
    sensitivity_areas: sensitivityAreasSchema
      .default([])
      .meta({ description: 'Sensitivity areas to track in meals' }),
    sync_intervals: syncIntervalsSchema.default({}).meta({
      description: 'Background sync poll intervals in minutes per provider (empty = server defaults)',
    }),
    sex: biologicalSexSchema
      .nullable()
      .default(null)
      .meta({ description: 'Biological sex for calorie calculation' }),
    sleep_need_minutes: sleepNeedMinutesSchema.default(defaultSleepNeedMinutes).meta({
      description: 'How much sleep you need per night, in minutes; sleep debt is judged against it',
    }),
    tag_icons: tagIconsSchema.default({}).meta({
      description: 'Tag icon mappings (deprecated, use item_icons)',
    }),
    tag_mappings: tagMappingsSchema
      .default({})
      .meta({ description: 'Tag name mappings from UUIDs to display names' }),
    timeline_show_replies: z.boolean().default(false).meta({
      description:
        "Whether followed actors' replies to posts that aren't in your timeline show as their own home-timeline cards (replies to you, mentions of you, and replies within a thread you already see always show)",
    }),
    timeline_daily_metrics: timelineDailyMetricsSchema.default([...defaultTimelineDailyMetrics]).meta({
      description: 'Daily metrics the Timeline draws as tracks when it shows more than three days',
    }),
    training_load: trainingLoadSettingsSchema
      .nullable()
      .default(null)
      .meta({ description: 'Training load (Banister model) parameters (null = defaults)' }),
    tz: z.string().nullable().default(null).meta({
      description:
        'User time zone (IANA). Set from the browser or in Settings on the web, and from the phone by the Android app while tz_follows_device is true; null means UTC.',
    }),
    tz_follows_device: z.boolean().default(true).meta({
      description:
        "Whether the Android app's sync sets tz from the phone's time zone; false once a zone is chosen by hand",
    }),
    weather_enabled: z.boolean().default(false).meta({
      description:
        'Whether the hourly weather where you were is fetched from Open-Meteo (coordinates rounded to 0.1°)',
    }),
  })
  .meta({ id: 'UserSettingsResponse' })

export type UserSettingsResponse = z.infer<typeof userSettingsResponseSchema>
