/**
 * The FIT file Garmin's push offers for an activity (`activityFiles`), fetched once the activity
 * row and the file notice are both here, whichever arrives last.
 */

import type { Activity } from '../../db/types.ts'
import type { auditError, auditInfo, auditWarn } from '../../services/audit-log.ts'
import type { processActivityFit } from './process.ts'

import { parseActivityFile } from './fit.ts'
import { redactAll } from './oauth-client.ts'
import { MAX_FILE_BYTES, readCapped } from './personal-client.ts'

export interface PushedActivityFileDeps {
  findActivityByGarminActivityId: (user: string, garminActivityId: number) => Promise<Activity | null>
  /** The stored `activityFiles` notice for the activity's FIT file, or null. */
  getFileNotice: (user: string, garminActivityId: number) => Promise<Record<string, unknown> | null>
  getAccessToken: (user: string) => Promise<string>
  /** GET with the bearer token; the body capped at `maxBytes`. */
  download: (url: string, accessToken: string) => Promise<{ status: number; bytes: Uint8Array | null }>
  processActivityFit: typeof processActivityFit
  markActivityDetailSynced: (user: string, activityId: string) => Promise<void>
  onDetailSynced?: (user: string, activityId: string) => void
  onTrackWritten?: (user: string, activityId: string) => void
  auditInfo: typeof auditInfo
  auditWarn: typeof auditWarn
  auditError: typeof auditError
}

const GARMIN_FILE_HOST = 'apis.garmin.com'

/** The callback URL is untrusted and the request carries the user's token: only Garmin's API host. */
export const isGarminFileUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === GARMIN_FILE_HOST &&
      url.port === '' &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The URL, its query and each token-length query value: any of them can carry Garmin's download token. */
const urlSecrets = (url: string): string[] => {
  const { search, searchParams } = new URL(url)
  return [url, search.slice(1), ...[...searchParams.values()].filter((value) => value.length >= 8)].filter(
    (secret) => secret.length > 0,
  )
}

const isGone = (status: number) => status === 404 || status === 410

const fetchAndProcess = async (
  deps: PushedActivityFileDeps,
  user: string,
  garminActivityId: number,
  activity: Activity & { id: string },
  url: string,
  token: string,
): Promise<void> => {
  const { bytes, status } = await deps.download(url, token)
  if (isGone(status)) {
    await deps.auditInfo(user, 'sync', `Garmin no longer serves the file for activity ${garminActivityId}`)
    return
  }
  if (status < 200 || status >= 300) {
    await deps.auditWarn(user, 'sync', `Garmin: the file for activity ${garminActivityId} was refused`, {
      status,
    })
    return
  }
  if (bytes === null) {
    await deps.auditWarn(user, 'sync', `Garmin: the file for activity ${garminActivityId} is too large`)
    return
  }

  const fit = parseActivityFile(bytes)
  if (!fit) {
    await deps.auditWarn(
      user,
      'sync',
      `Garmin: could not read the activity file for activity ${garminActivityId}`,
    )
    await deps.markActivityDetailSynced(user, activity.id)
    return
  }

  const activitySpan = activity.end_time ? { end: activity.end_time, start: activity.start_time } : null
  const count = await deps.processActivityFit(
    user,
    { fit, garminActivityId },
    {
      activityId: activity.id,
      activitySpan,
      activityStart: activity.start_time,
      onTrackWritten: deps.onTrackWritten,
    },
  )
  await deps.markActivityDetailSynced(user, activity.id)
  deps.onDetailSynced?.(user, activity.id)
  await deps.auditInfo(
    user,
    'sync',
    `📊 Synced ${count} detail metrics for Garmin activity ${garminActivityId} from its pushed FIT file`,
  )
}

/** Does nothing until both the activity and its FIT notice are stored; never puts the URL or token in an audit. */
export const syncPushedActivityFile = async (
  deps: PushedActivityFileDeps,
  user: string,
  garminActivityId: number,
): Promise<void> => {
  const activity = await deps.findActivityByGarminActivityId(user, garminActivityId)
  if (!activity?.id) return
  if (activity.data?.detail_synced === true) return
  const notice = await deps.getFileNotice(user, garminActivityId)
  if (!notice) return

  const url = notice.callbackURL
  if (!isGarminFileUrl(url)) {
    await deps.auditWarn(
      user,
      'sync',
      `Garmin: activity file address refused for activity ${garminActivityId}`,
    )
    return
  }

  let token: string | undefined
  try {
    token = await deps.getAccessToken(user)
    await fetchAndProcess(deps, user, garminActivityId, { ...activity, id: activity.id }, url, token)
  } catch (error) {
    await deps.auditError(
      user,
      'sync',
      `Failed to sync the pushed file for Garmin activity ${garminActivityId}`,
      {
        error: redactAll(errorText(error), [...urlSecrets(url), token]),
      },
    )
  }
}

export interface DownloadGarminFileOptions {
  fetch?: typeof fetch
  maxBytes?: number
  timeoutMs?: number
}

export const downloadGarminFile = async (
  url: string,
  accessToken: string,
  { fetch: fetchFn = fetch, maxBytes = MAX_FILE_BYTES, timeoutMs = 60_000 }: DownloadGarminFileOptions = {},
): Promise<{ status: number; bytes: Uint8Array | null }> => {
  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    return { bytes: null, status: res.status }
  }
  return { bytes: await readCapped(res, maxBytes), status: res.status }
}
