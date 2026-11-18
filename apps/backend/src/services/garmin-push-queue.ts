/**
 * The durable queue between storing a Garmin push and processing it (#1806). The push is
 * answered 200 only once its job is queued, so a restart or an overlapping deploy between the
 * answer and the processing loses nothing: the job is still in pg-boss and runs on whichever
 * process picks it up.
 *
 * Every job is its own: no singleton key, so no job is ever collapsed into another and dropped
 * with its records. A process runs one job at a time; two processes during an overlapping deploy
 * may run two at once, which is harmless because the worker reads each record's current data.
 */
import type { GarminPushJob, GarminPushRecordRef } from '../integrations/garmin/push.ts'
import type { PgBoss } from './pg-boss.ts'

import { createSerialQueue, garminPushTypeOfRecordType } from '../integrations/garmin/push.ts'

export const GARMIN_PUSH_QUEUE = 'garmin-push-process'

const RETRY_LIMIT = 3
const RETRY_DELAY_SECONDS = 120
export const GARMIN_PUSH_JOB_MAX_RECORDS = 2000

const DAY_MS = 24 * 60 * 60 * 1000
export const GARMIN_REPROCESS_DEFAULT_DAYS = 7
export const GARMIN_REPROCESS_MAX_DAYS = 90

export interface GarminPushQueue {
  enqueue: (job: GarminPushJob) => Promise<void>
}

export const chunkGarminPushJob = (
  { records, ...rest }: GarminPushJob,
  size = GARMIN_PUSH_JOB_MAX_RECORDS,
): GarminPushJob[] => {
  const chunks: GarminPushJob[] = []
  for (let i = 0; i < records.length; i += size) chunks.push({ ...rest, records: records.slice(i, i + size) })
  return chunks
}

/* v8 ignore start -- requires real pg-boss instance */
export const createGarminPushQueue = async (
  boss: PgBoss,
  process: (job: GarminPushJob) => Promise<void>,
): Promise<GarminPushQueue> => {
  await boss.createQueue(GARMIN_PUSH_QUEUE, { policy: 'standard' })

  // One job per fetch and one worker: a throwing job is retried alone, with backoff.
  await boss.work<GarminPushJob>(
    GARMIN_PUSH_QUEUE,
    { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2 },
    async ([job]) => {
      if (job) await process(job.data)
    },
  )

  console.info('⌚ Garmin push queue ready')

  return {
    enqueue: async (job) => {
      for (const chunk of chunkGarminPushJob(job)) {
        await boss.send(GARMIN_PUSH_QUEUE, chunk, {
          retryBackoff: true,
          retryDelay: RETRY_DELAY_SECONDS,
          retryLimit: RETRY_LIMIT,
        })
      }
    },
  }
}
/* v8 ignore stop */

/** Without pg-boss: processing in this process, one job after another, lost on a restart. */
export const inProcessGarminPushQueue = (
  process: (job: GarminPushJob) => Promise<void>,
  onError: (error: unknown) => void,
): GarminPushQueue => {
  const run = createSerialQueue(onError)
  return {
    enqueue: async (job) => {
      void run(() => process(job))
    },
  }
}

export interface ReprocessGarminPushesDeps {
  listPushRecordKeys: (user: string, since: Date) => Promise<{ record_type: string; external_id: string }[]>
  enqueue: (job: GarminPushJob) => Promise<void>
  now: () => Date
}

/** The default start of a reprocessing, and the earliest one allowed: an earlier time is taken as the limit. */
export const garminReprocessSince = (since: Date | undefined, now: Date): Date => {
  const earliest = new Date(now.getTime() - GARMIN_REPROCESS_MAX_DAYS * DAY_MS)
  if (!since) return new Date(now.getTime() - GARMIN_REPROCESS_DEFAULT_DAYS * DAY_MS)
  return since < earliest ? earliest : since
}

/**
 * Queues the user's pushed records received since the time for processing again, the same way
 * a fresh push is processed. Records of a type this server does not know are left out. Answers
 * how many records were queued.
 */
export const reprocessGarminPushes = async (
  deps: ReprocessGarminPushesDeps,
  user: string,
  since?: Date,
): Promise<number> => {
  const keys = await deps.listPushRecordKeys(user, garminReprocessSince(since, deps.now()))
  const records = keys.flatMap(({ external_id, record_type }): GarminPushRecordRef[] => {
    const type = garminPushTypeOfRecordType(record_type)
    return type ? [{ external_id, type }] : []
  })
  if (records.length > 0) await deps.enqueue({ records, replay: true, user })
  return records.length
}
