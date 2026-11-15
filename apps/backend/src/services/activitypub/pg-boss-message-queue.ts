import type { MessageQueue, MessageQueueEnqueueOptions, MessageQueueListenOptions } from '@fedify/fedify'

import type { PgBoss } from '../pg-boss.ts'

export type PgBossQueueClient = Pick<PgBoss, 'createQueue' | 'insert' | 'offWork' | 'send' | 'work'>

export interface PgBossMessageQueueOptions {
  pollingIntervalSeconds?: number
  localConcurrency?: number
}

const DEFAULT_POLLING_INTERVAL_SECONDS = 2
const DEFAULT_LOCAL_CONCURRENCY = 4
// A Fedify outbox message carries the sender's private key, so a finished job is not kept around.
const COMPLETED_JOB_RETENTION_SECONDS = 60 * 60

/**
 * Fedify owns the retry policy: a failed delivery is re-enqueued by Fedify with its own delay, so the
 * pg-boss job itself is never retried (retry limit 0) and a delivery is never retried twice over.
 */
const JOB_OPTIONS = { retryLimit: 0 } as const

const delaySeconds = (options?: MessageQueueEnqueueOptions): number | undefined => {
  const ms = options?.delay?.total('millisecond') ?? 0
  return ms > 0 ? ms / 1000 : undefined
}

const untilAborted = (signal: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve) => {
    if (signal == null) return
    if (signal.aborted) {
      resolve()
      return
    }
    signal.addEventListener('abort', () => resolve(), { once: true })
  })

/** A Fedify `MessageQueue` over one pg-boss queue; the queue is created before the adapter is returned. */
export const createPgBossMessageQueue = async (
  boss: PgBossQueueClient,
  name: string,
  options: PgBossMessageQueueOptions = {},
): Promise<MessageQueue> => {
  await boss.createQueue(name, { ...JOB_OPTIONS, deleteAfterSeconds: COMPLETED_JOB_RETENTION_SECONDS })
  return {
    enqueue: async (message: unknown, enqueueOptions?: MessageQueueEnqueueOptions) => {
      const startAfter = delaySeconds(enqueueOptions)
      await boss.send(name, message as object, {
        ...JOB_OPTIONS,
        ...(startAfter == null ? {} : { startAfter }),
      })
    },
    enqueueMany: async (messages: readonly unknown[], enqueueOptions?: MessageQueueEnqueueOptions) => {
      if (messages.length === 0) return
      const startAfter = delaySeconds(enqueueOptions)
      await boss.insert(
        name,
        messages.map((data) => ({
          ...JOB_OPTIONS,
          data: data as object,
          ...(startAfter == null ? {} : { startAfter }),
        })),
      )
    },
    listen: async (
      handler: (message: unknown) => Promise<void> | void,
      listenOptions?: MessageQueueListenOptions,
    ) => {
      const signal = listenOptions?.signal
      if (signal?.aborted) return
      const id = await boss.work<object>(
        name,
        {
          batchSize: 1,
          localConcurrency: options.localConcurrency ?? DEFAULT_LOCAL_CONCURRENCY,
          pollingIntervalSeconds: options.pollingIntervalSeconds ?? DEFAULT_POLLING_INTERVAL_SECONDS,
        },
        async (jobs) => {
          for (const job of jobs) await handler(job.data)
        },
      )
      await untilAborted(signal)
      await boss.offWork(name, { id, wait: true }).catch(() => {})
    },
    nativeRetrial: false,
  }
}
