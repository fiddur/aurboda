import type { OAuthToken } from '../../db/types.ts'
import type { CentralDb } from '../../services/central-db.ts'
import type { GarminSessionClient } from './client.ts'
import type { GarminPersonalClient } from './personal-client.ts'
import type { GarminDataType } from './process.ts'

import { getOAuthToken } from '../../db/index.ts'

/** The oauth_tokens provider of a Personal API key: the key in refresh_token, the cached JWT in access_token. */
export const GARMIN_PERSONAL_PROVIDER = 'garmin_personal'

export type GarminSource = 'session' | 'personal_key'

/**
 * A data type, the per-activity detail `syncActivityDetails` fetches (the FIT file through
 * the key, the JSON detail through the session), or the per-activity data only the session
 * serves (exercise sets, and the JSON detail when the FIT file is missing).
 */
export type GarminSourceTarget = GarminDataType | 'activityDetail' | 'activitySession'

export interface GarminConnections {
  session: boolean
  personal_key: {
    connected: boolean
    refused: boolean
    /** When Garmin last refused the key: the first refusal, or the last daily retry. */
    refusal_checked_at: Date | null
    expires_at: Date | null
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/** A refused key is exchanged again once a day, so a passing refusal (a WAF or geo block) does not lock it out. */
export const refusedKeyRetryDue = (checkedAt: Date, now: Date): boolean =>
  now.getTime() - checkedAt.getTime() >= DAY_MS

/** The key is good through its expiry date, counted in UTC days as the reminders count them. */
export const garminKeyExpired = (expiresAt: Date | null, now: Date): boolean =>
  expiresAt !== null && Math.floor(expiresAt.getTime() / DAY_MS) < Math.floor(now.getTime() / DAY_MS)

const keyUsable = ({ personal_key: key }: GarminConnections, now: Date): boolean =>
  key.connected &&
  !garminKeyExpired(key.expires_at, now) &&
  (!key.refused || (key.refusal_checked_at !== null && refusedKeyRetryDue(key.refusal_checked_at, now)))

/** The data types Garmin's Personal API serves. */
export const personalKeyDataTypes: ReadonlySet<GarminDataType> = new Set<GarminDataType>([
  'activities',
  'bodyBattery',
  'dailySummary',
  'heartRate',
  'hrv',
  'intensityMinutes',
  'respiration',
  'sleep',
  'spo2',
])

/**
 * A usable key serves every type it covers, except sleep when a session also
 * exists: only the session's answer carries the stage timeline. The activity
 * detail comes from the key whenever it is usable: its FIT file is the full
 * recording, where the session's JSON is a chart downsampled to 10000 points.
 * Anything else needs the session, and is skipped without one.
 */
export const chooseGarminSource = (
  target: GarminSourceTarget,
  connections: GarminConnections,
  now: Date = new Date(),
): GarminSource | null => {
  if (target === 'activityDetail' && keyUsable(connections, now)) return 'personal_key'
  if (
    target !== 'activityDetail' &&
    target !== 'activitySession' &&
    keyUsable(connections, now) &&
    personalKeyDataTypes.has(target)
  ) {
    return target === 'sleep' && connections.session ? 'session' : 'personal_key'
  }
  return connections.session ? 'session' : null
}

export interface GarminConnectionDeps {
  getOAuthToken: (user: string, provider: string) => Promise<OAuthToken | null>
}

const defaultConnectionDeps: GarminConnectionDeps = {
  getOAuthToken: (user, provider) => getOAuthToken(user, provider),
}

/** Disconnecting the session keeps its row with an empty token, so the row alone does not mean connected. */
export const getGarminConnections = async (
  user: string,
  deps: GarminConnectionDeps = defaultConnectionDeps,
): Promise<GarminConnections> => {
  const [session, personal] = await Promise.all([
    deps.getOAuthToken(user, 'garmin'),
    deps.getOAuthToken(user, GARMIN_PERSONAL_PROVIDER),
  ])
  const keyStored = !!personal?.refresh_token
  return {
    personal_key: {
      connected: keyStored,
      expires_at: keyStored ? (personal.expires_at ?? null) : null,
      refusal_checked_at:
        keyStored && personal.refused_at ? (personal.updated_at ?? personal.refused_at) : null,
      refused: keyStored && personal.refused_at != null,
    },
    session: session !== null && session.access_token !== '',
  }
}

/** A refused key still counts, so the user keeps seeing Garmin's page and its warning. */
export const hasGarminConnection = async (
  user: string,
  deps: GarminConnectionDeps = defaultConnectionDeps,
): Promise<boolean> => {
  const connections = await getGarminConnections(user, deps)
  return connections.session || connections.personal_key.connected
}

/** The admin switch for new Personal API key connections; on until an admin turns it off. */
export const readGarminPersonalKeyEnabled = async (
  centralDb: Pick<CentralDb, 'getServerSetting'>,
): Promise<boolean> => (await centralDb.getServerSetting('garmin_personal_key_enabled')) !== false

export interface GarminRoutedClientDeps {
  session: GarminSessionClient
  personal: GarminPersonalClient
  getConnections?: (user: string) => Promise<GarminConnections>
}

/**
 * The session client's surface, where each data type the Personal API covers
 * is fetched through whichever connection `chooseGarminSource` picks.
 */
export const garminRoutedClient = ({
  session,
  personal,
  getConnections = (user) => getGarminConnections(user),
}: GarminRoutedClientDeps) => {
  const sourceFor = async (user: string, target: GarminSourceTarget): Promise<GarminSource | null> =>
    chooseGarminSource(target, await getConnections(user))

  const usesKey = async (user: string, dataType: GarminDataType): Promise<boolean> =>
    (await sourceFor(user, dataType)) === 'personal_key'

  return {
    disconnect: session.disconnect,
    getActivities: async (user: string, start: number, limit: number) =>
      (await usesKey(user, 'activities'))
        ? personal.getActivities(user, start, limit)
        : session.getActivities(user, start, limit),
    getActivityDetail: session.getActivityDetail,
    getActivityExerciseSets: session.getActivityExerciseSets,
    getActivityFile: personal.getActivityFile,
    getBodyBattery: async (user: string, startDate: Date, endDate: Date) =>
      (await usesKey(user, 'bodyBattery'))
        ? personal.getBodyBattery(user, startDate, endDate)
        : session.getBodyBattery(user, startDate, endDate),
    getDailySummary: async (user: string, date: Date) =>
      (await usesKey(user, 'dailySummary'))
        ? personal.getDailySummary(user, date)
        : session.getDailySummary(user, date),
    getHeartRate: async (user: string, date: Date) =>
      (await usesKey(user, 'heartRate'))
        ? personal.getHeartRate(user, date)
        : session.getHeartRate(user, date),
    getHrv: async (user: string, date: Date) =>
      (await usesKey(user, 'hrv')) ? personal.getHrv(user, date) : session.getHrv(user, date),
    getIntensityMinutes: async (user: string, date: Date) =>
      (await usesKey(user, 'intensityMinutes'))
        ? personal.getIntensityMinutes(user, date)
        : session.getIntensityMinutes(user, date),
    getRespiration: async (user: string, date: Date) =>
      (await usesKey(user, 'respiration'))
        ? personal.getRespiration(user, date)
        : session.getRespiration(user, date),
    getSleep: async (user: string, date: Date) =>
      (await usesKey(user, 'sleep')) ? personal.getSleep(user, date) : session.getSleep(user, date),
    getSpo2: async (user: string, date: Date) =>
      (await usesKey(user, 'spo2')) ? personal.getSpo2(user, date) : session.getSpo2(user, date),
    getStress: session.getStress,
    getTrainingReadiness: session.getTrainingReadiness,
    login: session.login,
    sourceFor,
    verifyMfa: session.verifyMfa,
  }
}

export type GarminClient = ReturnType<typeof garminRoutedClient>
