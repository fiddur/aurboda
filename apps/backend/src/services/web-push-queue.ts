import type { PgBoss } from './pg-boss.ts'
import type { PushDelivery } from './web-push.ts'

const QUEUE_NAME = 'web-push'
const RETRY_LIMIT = 2
const RETRY_DELAY_SECONDS = 30

export interface WebPushJobData {
  user: string
  notification_id: string
}

export interface WebPushQueueDeps {
  deliver: (user: string, notificationId: string, options: { retry: boolean }) => Promise<PushDelivery>
}

export interface WebPushQueue {
  enqueue: (user: string, notificationId: string) => Promise<void>
}

/** Throws when a browser could not be reached, so that pg-boss retries the job with backoff. */
export const runWebPushJob = async (
  deps: WebPushQueueDeps,
  data: WebPushJobData,
  retryCount: number,
): Promise<PushDelivery> => {
  const delivery = await deps.deliver(data.user, data.notification_id, { retry: retryCount > 0 })
  if (delivery.failed > 0) {
    throw new Error(`Web Push failed for ${delivery.failed} browser(s) of ${data.user}`)
  }
  return delivery
}

/* v8 ignore start -- requires real pg-boss instance */
export const createWebPushQueue = async (boss: PgBoss, deps: WebPushQueueDeps): Promise<WebPushQueue> => {
  await boss.createQueue(QUEUE_NAME)
  await boss.work<WebPushJobData>(
    QUEUE_NAME,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 2 },
    async ([job]) => {
      if (job) await runWebPushJob(deps, job.data, job.retryCount)
    },
  )
  console.info('🔔 Web Push queue ready')
  return {
    enqueue: async (user, notificationId) => {
      await boss.send(
        QUEUE_NAME,
        { notification_id: notificationId, user },
        { retryBackoff: true, retryDelay: RETRY_DELAY_SECONDS, retryLimit: RETRY_LIMIT },
      )
    },
  }
}
/* v8 ignore stop */
