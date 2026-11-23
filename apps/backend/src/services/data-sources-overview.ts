import {
  connectableSources,
  dataKinds,
  dataSourceGroups,
  type DataSourceId,
  type DataSourcesOverview,
  type DataSourceStatus,
  type UserSettingsResponse,
} from '@aurboda/api-spec'

import { getRecentSourceActivity, type RecentSourceActivity } from '../db/index.ts'
import { getSettingsResponse } from './settings.ts'

export type SourceSettings = Pick<
  UserSettingsResponse,
  | 'calendars'
  | 'garmin_connected'
  | 'gravl_connection'
  | 'home_assistant_entity_id'
  | 'home_assistant_token_set'
  | 'home_assistant_url'
  | 'lastfm_username'
  | 'oura_connected'
  | 'rescue_time_key'
  | 'strava_connected'
>

export interface DataSourceSignals {
  settings: SourceSettings
  activity: RecentSourceActivity
}

interface SourceState {
  status: DataSourceStatus
  detail: string
}

const activeIf = (active: boolean, activeDetail: string, inactiveDetail: string): SourceState =>
  active ? { detail: activeDetail, status: 'active' } : { detail: inactiveDetail, status: 'not_set_up' }

const connected = (active: boolean): SourceState => activeIf(active, 'Connected', 'Not connected')

const hasProductivity = (activity: RecentSourceActivity, source: string, isMobile?: boolean): boolean =>
  activity.productivity.some(
    (p) => p.source === source && (isMobile === undefined || p.is_mobile === isMobile),
  )

const rescueTimeState = ({ settings, activity }: DataSourceSignals): SourceState => {
  if (!settings.rescue_time_key) return { detail: 'Not configured', status: 'not_set_up' }
  return hasProductivity(activity, 'rescuetime')
    ? { detail: 'Data syncing', status: 'active' }
    : { detail: 'Configured, no recent data', status: 'configured' }
}

const calendarsState = ({ settings }: DataSourceSignals): SourceState => {
  const count = settings.calendars?.length ?? 0
  return activeIf(count > 0, `${count} calendar(s) configured`, 'No calendars added')
}

const sourceStates: Record<DataSourceId, (signals: DataSourceSignals) => SourceState> = {
  activitywatch_android: ({ activity }) =>
    activeIf(hasProductivity(activity, 'activitywatch', true), 'Mobile data syncing', 'Not set up'),
  activitywatch_desktop: ({ activity }) =>
    activeIf(hasProductivity(activity, 'activitywatch', false), 'Desktop data syncing', 'Not set up'),
  android_app: ({ activity }) =>
    activeIf(
      activity.health_connect,
      'Health Connect data received in the last 30 days',
      'No data from Android app yet',
    ),
  aurboda: () => ({ detail: 'Always available', status: 'active' }),
  calendars: calendarsState,
  garmin: ({ settings }) => connected(settings.garmin_connected),
  gravl: ({ settings }) => connected(!!settings.gravl_connection),
  home_assistant: ({ settings }) =>
    connected(
      !!settings.home_assistant_url &&
        settings.home_assistant_token_set &&
        !!settings.home_assistant_entity_id,
    ),
  lastfm: ({ settings }) => activeIf(!!settings.lastfm_username, 'Connected', 'Not configured'),
  oura: ({ settings }) => connected(settings.oura_connected),
  owntracks: ({ activity }) =>
    activeIf(
      activity.location_sources.includes('owntracks'),
      'Data received in the last 7 days',
      'No data in the last 7 days',
    ),
  rescuetime: rescueTimeState,
  strava: ({ settings }) => connected(settings.strava_connected),
}

export const buildDataSourcesOverview = (signals: DataSourceSignals): DataSourcesOverview => {
  const sources = connectableSources.map((source) => ({
    group: source.group,
    id: source.id,
    kinds: [...source.kinds],
    name: source.name,
    path: source.path,
    ...sourceStates[source.id](signals),
  }))
  const kinds = dataKinds.map((kind) => {
    const bringing = sources.filter((source) => source.kinds.includes(kind.id))
    const active = bringing.filter((source) => source.status === 'active').map((source) => source.id)
    return {
      active_sources: active,
      available_sources: bringing.map((source) => source.id),
      id: kind.id,
      label: kind.label,
      one_source_enough: kind.one_source_enough,
      overlap: kind.one_source_enough && active.length >= 2,
      overlap_hint: kind.overlap_hint ?? null,
    }
  })
  return { groups: dataSourceGroups.map(({ id, label }) => ({ id, label })), kinds, sources }
}

const DAY_MS = 24 * 60 * 60 * 1000

export interface DataSourcesOverviewDeps {
  loadSettings: (user: string) => Promise<SourceSettings>
  loadActivity: (user: string, since: { since7d: Date; since30d: Date }) => Promise<RecentSourceActivity>
  now: () => Date
}

const defaultDeps: DataSourcesOverviewDeps = {
  loadActivity: getRecentSourceActivity,
  loadSettings: getSettingsResponse,
  now: () => new Date(),
}

export const getDataSourcesOverview = async (
  user: string,
  deps: DataSourcesOverviewDeps = defaultDeps,
): Promise<DataSourcesOverview> => {
  const now = deps.now().getTime()
  const [settings, activity] = await Promise.all([
    deps.loadSettings(user),
    deps.loadActivity(user, { since30d: new Date(now - 30 * DAY_MS), since7d: new Date(now - 7 * DAY_MS) }),
  ])
  return buildDataSourcesOverview({ activity, settings })
}
