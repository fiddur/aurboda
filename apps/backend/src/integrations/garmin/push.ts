/**
 * The receiving end of the Garmin Developer Program's push: Garmin POSTs each user's new
 * summaries to one secret URL. Every item is kept as a raw record and a job naming those
 * records is put on a durable queue before the answer, so Garmin's 30 s deadline never waits
 * on processing and a restart between the answer and the processing loses nothing.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

import type { RawRecord, SyncState, TimeSeriesPoint } from '../../db/types.ts'
import type { auditError, auditInfo, auditWarn } from '../../services/audit-log.ts'
import type { GarminGrantProbe } from './oauth-client.ts'
import type { GarminDataType } from './process.ts'

import { GARMIN_PUSH_PROVIDER } from './oauth-status.ts'
import {
  adaptGarminPushItem,
  garminPushFeeds,
  garminPushSideFeeds,
  garminPushTypes,
  isCalendarDate,
  isPlainObject,
  noonUtc,
  pushedGarminActivityId,
} from './push-adapters.ts'

export const garminPushToken = (sessionSecret: string): string =>
  createHmac('sha256', sessionSecret).update('garmin-push').digest('base64url')

/** The URL the admin registers for every summary type. It carries the secret: show it to the admin only. */
export const garminPushUrl = (apiBaseUrl: string, sessionSecret: string): string =>
  `${apiBaseUrl}/webhooks/garmin/${garminPushToken(sessionSecret)}`

export const isGarminPushToken = (given: string, expected: string): boolean => {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** One stored push item: Garmin's type key and the raw record's external id. */
export interface GarminPushRecordRef {
  type: string
  external_id: string
}

/** What the queue carries: no item data, no Garmin user id, no token. */
export interface GarminPushJob {
  user: string
  records: GarminPushRecordRef[]
  /**
   * Stored pushes processed again: no push sync state is written, so a replay never makes
   * Connect with Garmin look like it delivers (`garminPushDelivered`) when Garmin stopped pushing.
   */
  replay?: boolean
}

export interface GarminPushDeps {
  pushToken: string
  /** The configured `garmin_client_id`; without one the endpoint does not exist. */
  getClientId: () => Promise<string | null>
  getUsernameByGarminUserId: (garminUserId: string) => Promise<string | null>
  isReadOnly: (user: string) => Promise<boolean>
  getDisabledDataTypes: (user: string) => Promise<readonly GarminDataType[]>
  insertRawRecords: (user: string, records: RawRecord[]) => Promise<void>
  /** Puts the processing of stored records on the durable queue; a failure is answered 500. */
  enqueuePush: (job: GarminPushJob) => Promise<void>
  probeGrant: (user: string) => Promise<GarminGrantProbe>
  /** Drops the grant, the mapping and the push sync states without calling Garmin. */
  forgetGrant: (user: string) => Promise<void>
  updateGrantScopes: (user: string, scopes: string[]) => Promise<unknown>
  auditInfo: typeof auditInfo
  auditWarn: typeof auditWarn
  auditError: typeof auditError
  /** Server log, for what belongs to no user. Counts only. */
  logWarn: (message: string) => void
  now: () => Date
}

export interface GarminPushProcessDeps {
  isReadOnly: (user: string) => Promise<boolean>
  getDisabledDataTypes: (user: string) => Promise<readonly GarminDataType[]>
  /** The stored data of each found record by external id; a missing one is left out. */
  getPushRecords: (user: string, recordType: string, externalIds: string[]) => Promise<Map<string, unknown>>
  /** `processGarminData` with raw records left out: the push keeps its own. */
  processGarminData: (user: string, dataType: GarminDataType, data: unknown) => Promise<number>
  insertTimeSeries: (user: string, points: TimeSeriesPoint[]) => Promise<unknown>
  upsertSyncState: (user: string, state: SyncState) => Promise<void>
  /** Fetches and processes the activity's pushed FIT file once both it and its notice are here. */
  syncActivityFile: (user: string, garminActivityId: number) => Promise<void>
  onActivitySynced: (user: string, start: Date, end: Date) => void
  auditError: typeof auditError
  now: () => Date
}

export interface GarminPushRequest {
  token: string
  clientIdHeader: string | undefined
  body: unknown
}

export interface GarminPushResult {
  status: 200 | 403 | 404 | 500
  /** The connection notices, handled after the answer is sent; never throws. */
  process?: () => Promise<void>
}

type Item = Record<string, unknown>

const PUSH_TYPE = /^[A-Za-z][A-Za-z0-9]{0,63}$/

export const garminPushRecordType = (type: string): string =>
  `garmin_push_${type
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()}`

const pushTypeByRecordType = new Map(
  Object.keys(garminPushTypes).map((type) => [garminPushRecordType(type), type] as const),
)

/** The Garmin type key of a stored push record; undefined for a type nothing processes. */
export const garminPushTypeOfRecordType = (recordType: string): string | undefined =>
  pushTypeByRecordType.get(recordType)

const idPart = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== ''
    ? value
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : undefined

/** An activity's FIT, TCX and GPX notices each keep their own record, found by exact id. */
const activityFileExternalId = (item: Item): string | undefined => {
  const activityId = pushedGarminActivityId(item)
  if (activityId === undefined) return undefined
  const fileType = typeof item.fileType === 'string' && item.fileType !== '' ? item.fileType : 'unknown'
  return `file-${activityId}-${fileType.toLowerCase()}`
}

export const garminPushExternalId = (type: string, item: Item): string | undefined => {
  if (type === 'activityFiles') {
    const fileId = activityFileExternalId(item)
    if (fileId) return fileId
  }
  const summaryId = idPart(item.summaryId)
  if (summaryId) return summaryId
  const activityId = idPart(item.activityId)
  if (activityId) return activityId
  const when =
    idPart(item.startTimeInSeconds) ??
    idPart(item.measurementTimeInSeconds) ??
    (isCalendarDate(item.calendarDate) ? item.calendarDate : undefined)
  return when ? `${type}-${when}` : undefined
}

const seconds = (value: unknown): Date | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000) : undefined

export const garminPushRecordedAt = (item: Item, now: Date): Date =>
  seconds(item.startTimeInSeconds) ??
  seconds(item.measurementTimeInSeconds) ??
  (isCalendarDate(item.calendarDate) ? noonUtc(item.calendarDate) : now)

/** The item as it is stored: without the old per-user token and without the Garmin user id. */
const stripped = (item: Item): Item => {
  const { userAccessToken: _token, userId: _userId, ...rest } = item
  return rest
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const isLifecycle = (type: string) => type === 'deregistrations' || type === 'userPermissionsChange'

interface StoredItem {
  item: Item
  feeds: GarminDataType[]
}

interface UserPush {
  user: string
  garminUserId: string
  lifecycle: Map<string, Item[]>
}

const groupByGarminUser = (body: Item) => {
  const byUser = new Map<string, Map<string, Item[]>>()
  let dropped = 0
  for (const [type, items] of Object.entries(body)) {
    if (!Array.isArray(items)) continue
    if (!PUSH_TYPE.test(type)) {
      dropped += items.length
      continue
    }
    for (const item of items) {
      const garminUserId = isPlainObject(item) ? idPart(item.userId) : undefined
      if (!garminUserId) {
        dropped++
        continue
      }
      const types = byUser.get(garminUserId) ?? new Map<string, Item[]>()
      byUser.set(garminUserId, types)
      types.set(type, [...(types.get(type) ?? []), item as Item])
    }
  }
  return { byUser, dropped }
}

const ACTIVITY_TYPES = new Set(['activities', 'manuallyUpdatedActivities'])
const ACTIVITY_WRITING_TYPES = new Set(['sleeps', ...ACTIVITY_TYPES])
const DAY_MS = 24 * 60 * 60 * 1000

/** The activity of each item is a row by the time its file notice is handled. */
const processingOrder = (stored: Map<string, StoredItem[]>): [string, StoredItem[]][] =>
  [...stored].sort(([a], [b]) => Number(a === 'activityFiles') - Number(b === 'activityFiles'))

const isFitNotice = (item: Item): boolean =>
  typeof item.fileType === 'string' && item.fileType.toUpperCase() === 'FIT'

/** The earliest start and latest end of the items; the last day when none has a usable time. */
const pushedSpan = (items: Item[], now: Date): { start: Date; end: Date } => {
  const spans = items.flatMap((item) => {
    const start = typeof item.startTimeInSeconds === 'number' ? item.startTimeInSeconds : NaN
    if (!Number.isFinite(start)) return []
    const duration =
      typeof item.durationInSeconds === 'number' && Number.isFinite(item.durationInSeconds)
        ? item.durationInSeconds
        : 0
    return [{ end: (start + duration) * 1000, start: start * 1000 }]
  })
  if (spans.length === 0) return { end: now, start: new Date(now.getTime() - DAY_MS) }
  return {
    end: new Date(Math.max(...spans.map((span) => span.end))),
    start: new Date(Math.min(...spans.map((span) => span.start))),
  }
}

const processItem = async (
  deps: GarminPushProcessDeps,
  user: string,
  type: string,
  { feeds, item }: StoredItem,
) => {
  const adapted = adaptGarminPushItem(type, item)
  for (const { data, dataType } of adapted.garmin) {
    if (feeds.includes(dataType)) await deps.processGarminData(user, dataType, data)
  }
  if (adapted.points.length > 0) await deps.insertTimeSeries(user, adapted.points)
  const feedPoints = (adapted.feedPoints ?? []).flatMap(({ dataType, points }) =>
    feeds.includes(dataType) ? points : [],
  )
  if (feedPoints.length > 0) await deps.insertTimeSeries(user, feedPoints)

  const fileWanted = ACTIVITY_TYPES.has(type) || (type === 'activityFiles' && isFitNotice(item))
  const activityId = fileWanted ? pushedGarminActivityId(item) : undefined
  if (activityId !== undefined) await deps.syncActivityFile(user, activityId)
}

/** Every type is processed; the ones that failed are answered. */
const processData = async (
  deps: GarminPushProcessDeps,
  user: string,
  stored: Map<string, StoredItem[]>,
  replay: boolean,
): Promise<string[]> => {
  const failed: string[] = []
  for (const [type, entries] of processingOrder(stored)) {
    try {
      for (const entry of entries) await processItem(deps, user, type, entry)
      if (!replay) {
        await deps.upsertSyncState(user, {
          data_type: type,
          error_message: undefined,
          last_sync_time: deps.now(),
          provider: GARMIN_PUSH_PROVIDER,
          retry_after: undefined,
          status: 'idle',
        })
      }
      if (ACTIVITY_WRITING_TYPES.has(type)) {
        const { end, start } = pushedSpan(
          entries.map((entry) => entry.item),
          deps.now(),
        )
        deps.onActivitySynced(user, start, end)
      }
    } catch (error) {
      failed.push(type)
      await deps
        .auditError(user, 'sync', `Garmin: processing pushed ${type} failed`, {
          error: errorText(error),
        })
        .catch(() => {})
      if (replay) continue
      await deps
        .upsertSyncState(user, {
          data_type: type,
          error_message: errorText(error),
          last_sync_time: deps.now(),
          provider: GARMIN_PUSH_PROVIDER,
          retry_after: undefined,
          status: 'error',
        })
        .catch(() => {})
    }
  }
  return failed
}

const groupRefsByType = (records: GarminPushRecordRef[]): Map<string, string[]> => {
  const byType = new Map<string, Set<string>>()
  for (const { external_id, type } of records) {
    byType.set(type, (byType.get(type) ?? new Set()).add(external_id))
  }
  return new Map([...byType].map(([type, ids]) => [type, [...ids]]))
}

const uniqueRefs = (refs: GarminPushRecordRef[]): GarminPushRecordRef[] =>
  [...groupRefsByType(refs)].flatMap(([type, ids]) => ids.map((external_id) => ({ external_id, type })))

/**
 * Processes the newest stored version of each named record, so the order of two jobs for one
 * record does not matter. Throws when a type failed, for the queue to retry the job: processing
 * is idempotent upserts, so the types that succeeded are harmless to run again.
 */
export const processGarminPushJob = async (
  deps: GarminPushProcessDeps,
  { records, replay, user }: GarminPushJob,
): Promise<void> => {
  if (records.length === 0 || (await deps.isReadOnly(user))) return
  const disabled = await deps.getDisabledDataTypes(user)
  const stored = new Map<string, StoredItem[]>()

  for (const [type, externalIds] of groupRefsByType(records)) {
    if (isLifecycle(type) || !PUSH_TYPE.test(type)) continue
    const feeds = garminPushFeeds(type)
    if (feeds.length > 0 && feeds.every((feed) => disabled.includes(feed))) continue
    const enabled = [...feeds, ...garminPushSideFeeds(type)].filter((feed) => !disabled.includes(feed))
    const found = await deps.getPushRecords(user, garminPushRecordType(type), externalIds)
    const entries = externalIds.flatMap((id) => {
      const item = found.get(id)
      return isPlainObject(item) ? [{ feeds: enabled, item }] : []
    })
    if (entries.length > 0) stored.set(type, entries)
  }

  const failed = await processData(deps, user, stored, replay === true)
  if (failed.length > 0) throw new Error(`Garmin push: processing ${failed.join(', ')} failed`)
}

const handleDeregistration = async (deps: GarminPushDeps, { garminUserId, user }: UserPush) => {
  const probe = await deps.probeGrant(user)
  if (probe.status === 'alive') {
    if (probe.garminUserId === garminUserId) {
      await deps.auditInfo(user, 'auth', 'Garmin: deregistration ignored, the connection still works')
    } else {
      await deps.auditWarn(
        user,
        'auth',
        'Garmin: deregistration ignored, the connection belongs to another Garmin account',
      )
    }
    return
  }
  if (probe.status === 'gone') {
    await deps.forgetGrant(user)
    await deps.auditWarn(user, 'auth', 'Garmin: access removed from the Garmin side')
    return
  }
  await deps.auditWarn(user, 'auth', 'Garmin: could not check a deregistration; the connection is kept', {
    error: probe.error,
  })
}

const handlePermissionsChange = async (deps: GarminPushDeps, user: string, items: Item[]) => {
  const latest = items.findLast((item) => Array.isArray(item.permissions))
  if (!latest) return
  const permissions = (latest.permissions as unknown[]).filter((p): p is string => typeof p === 'string')
  await deps.updateGrantScopes(user, permissions)
  await deps.auditInfo(user, 'auth', 'Garmin: shared data changed', { permissions })
}

const processLifecycle = async (deps: GarminPushDeps, push: UserPush): Promise<void> => {
  const { lifecycle, user } = push
  try {
    const permissionChanges = lifecycle.get('userPermissionsChange')
    if (permissionChanges) await handlePermissionsChange(deps, user, permissionChanges)
    if (lifecycle.has('deregistrations')) await handleDeregistration(deps, push)
  } catch (error) {
    await deps.auditError(user, 'auth', 'Garmin: handling a connection notice failed', {
      error: errorText(error),
    })
  }
}

const countsOf = (refs: GarminPushRecordRef[]) => {
  const counts: Record<string, number> = {}
  for (const { type } of refs) counts[type] = (counts[type] ?? 0) + 1
  return counts
}

/** Stores and enqueues what is needed for the 200, and answers how to handle the connection notices afterwards. */
// eslint-disable-next-line complexity -- one pass over Garmin's envelope: gate, group, resolve, store, enqueue
export const receiveGarminPush = async (
  deps: GarminPushDeps,
  { body, clientIdHeader, token }: GarminPushRequest,
): Promise<GarminPushResult> => {
  if (!isGarminPushToken(token, deps.pushToken)) return { status: 404 }
  const clientId = await deps.getClientId()
  if (!clientId) return { status: 404 }
  if (clientIdHeader !== undefined && clientIdHeader !== clientId) return { status: 403 }
  if (!isPlainObject(body)) return { status: 200 }

  const { byUser, dropped } = groupByGarminUser(body)
  let unmapped = 0
  let unidentified = dropped
  const pushes: UserPush[] = []
  const now = deps.now()

  for (const [garminUserId, types] of byUser) {
    const user = await deps.getUsernameByGarminUserId(garminUserId)
    if (!user) {
      unmapped += [...types.values()].reduce((sum, items) => sum + items.length, 0)
      continue
    }
    const push: UserPush = { garminUserId, lifecycle: new Map(), user }
    // A read-only account stores nothing, but Garmin withdrawing its access is still acted on.
    if (await deps.isReadOnly(user)) {
      for (const [type, items] of types) if (isLifecycle(type)) push.lifecycle.set(type, items)
      if (push.lifecycle.size > 0) pushes.push(push)
      continue
    }
    const dataTypes = [...types.keys()].filter((type) => !isLifecycle(type))
    const disabled = dataTypes.length > 0 ? await deps.getDisabledDataTypes(user) : []
    const skipped: Record<string, number> = {}
    const records: RawRecord[] = []
    const refs: GarminPushRecordRef[] = []

    for (const [type, items] of types) {
      if (isLifecycle(type)) {
        push.lifecycle.set(type, items)
        continue
      }
      const feeds = garminPushFeeds(type)
      if (feeds.length > 0 && feeds.every((feed) => disabled.includes(feed))) {
        skipped[type] = items.length
        continue
      }
      for (const item of items) {
        const externalId = garminPushExternalId(type, item)
        if (!externalId) {
          unidentified++
          continue
        }
        records.push({
          data: stripped(item),
          external_id: externalId,
          record_type: garminPushRecordType(type),
          recorded_at: garminPushRecordedAt(item, now),
          source: 'garmin',
        })
        refs.push({ external_id: externalId, type })
      }
    }

    try {
      await deps.insertRawRecords(user, records)
    } catch (error) {
      deps.logWarn(`Garmin push: storing failed, Garmin will retry: ${errorText(error)}`)
      return { status: 500 }
    }
    if (refs.length > 0) {
      try {
        await deps.enqueuePush({ records: uniqueRefs(refs), user })
      } catch (error) {
        deps.logWarn(`Garmin push: queueing failed, Garmin will retry: ${errorText(error)}`)
        return { status: 500 }
      }
    }

    if (refs.length > 0 || Object.keys(skipped).length > 0) {
      void deps
        .auditInfo(user, 'sync', 'Garmin: data received', {
          counts: countsOf(refs),
          ...(Object.keys(skipped).length > 0 ? { skipped_disabled: skipped } : {}),
        })
        .catch(() => {})
    }
    if (push.lifecycle.size > 0) pushes.push(push)
  }

  if (unmapped > 0) {
    deps.logWarn(`Garmin push: ${unmapped} item(s) for Garmin users not connected here dropped`)
  }
  if (unidentified > 0) {
    deps.logWarn(`Garmin push: ${unidentified} item(s) without a user or summary id dropped`)
  }

  if (pushes.length === 0) return { status: 200 }
  return {
    process: async () => {
      for (const push of pushes) await processLifecycle(deps, push)
    },
    status: 200,
  }
}

/** One promise chain: each job starts when the one before it has finished, whatever it did. */
export const createSerialQueue = (onError: (error: unknown) => void = () => {}) => {
  let tail: Promise<void> = Promise.resolve()
  return (job: () => Promise<void>): Promise<void> => {
    tail = tail.then(job).catch(onError)
    return tail
  }
}
