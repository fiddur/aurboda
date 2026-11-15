import {
  createExponentialBackoffPolicy,
  type FederationOptions,
  type MessageQueue,
  type MessageQueueEnqueueOptions,
  type MessageQueueListenOptions,
  type OutboxPermanentFailureHandler,
  type RetryPolicy,
  SendActivityError,
} from '@fedify/fedify'
import { AsyncLocalStorage } from 'node:async_hooks'
import { STATUS_CODES } from 'node:http'

import type { FederationDeliveryFailuresApi } from '../central-federation-delivery.ts'
import type { PgBoss } from '../pg-boss.ts'

import { createPgBossMessageQueue, type PgBossMessageQueueOptions } from './pg-boss-message-queue.ts'

export const OUTBOX_QUEUE = 'fedify-outbox'
export const FANOUT_QUEUE = 'fedify-fanout'

// 1 min × 4ⁿ (×1–2 jitter), capped at 12 h: ten attempts in all span roughly two to three days.
export const RETRY_INITIAL_DELAY = { minutes: 1 } as const
export const RETRY_FACTOR = 4
export const RETRY_MAX_DELAY = { hours: 12 } as const
export const RETRY_MAX_ATTEMPTS = 10
export const PERMANENT_FAILURE_STATUS_CODES = [404, 410] as const
export const CIRCUIT_HELD_ACTIVITY_TTL = { days: 3 } as const

export const deliveryRetryPolicy = (): RetryPolicy =>
  createExponentialBackoffPolicy({
    factor: RETRY_FACTOR,
    initialDelay: RETRY_INITIAL_DELAY,
    maxAttempts: RETRY_MAX_ATTEMPTS - 1,
    maxDelay: RETRY_MAX_DELAY,
  })

const ERROR_LINE_MAX = 200

const truncate = (text: string): string =>
  text.length > ERROR_LINE_MAX ? `${text.slice(0, ERROR_LINE_MAX - 1)}…` : text

const causeCode = (error: Error): string | null => {
  const cause = (error as { cause?: unknown }).cause
  if (cause != null && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') {
    return cause.code
  }
  return null
}

/** A status line for an admin: status code and reason, never a payload or a response body. */
export const deliveryErrorLine = (error: Error): { status: number | null; line: string } => {
  if (error instanceof SendActivityError) {
    const reason = STATUS_CODES[error.statusCode]
    return {
      line: truncate(`HTTP ${error.statusCode}${reason == null ? '' : ` ${reason}`}`),
      status: error.statusCode,
    }
  }
  const code = causeCode(error)
  const firstLine = (error.message.split('\n')[0] ?? '').trim()
  return { line: truncate(`${error.name}: ${code ?? firstLine}`), status: null }
}

const hostOf = (inbox: string): string | null => {
  try {
    return new URL(inbox).host
  } catch {
    return null
  }
}

interface AttemptState {
  inbox: string
  failed: boolean
  requeued: boolean
}

export interface DeliveryObserverDeps {
  store: Pick<FederationDeliveryFailuresApi, 'recordDeliveryFailure' | 'recordDeliverySuccess'>
  logError?: (message: string, error: unknown) => void
}

export interface DeliveryObserver {
  /** Wraps the outbox queue so that each attempt's outcome is known for its inbox. */
  observe: (queue: MessageQueue) => MessageQueue
  onOutboxError: NonNullable<FederationOptions<void>['onOutboxError']>
  onPermanentFailure: OutboxPermanentFailureHandler<void>
}

const isOutboxMessage = (message: unknown): message is { type: 'outbox'; inbox: string } =>
  message != null &&
  typeof message === 'object' &&
  (message as { type?: unknown }).type === 'outbox' &&
  typeof (message as { inbox?: unknown }).inbox === 'string'

/**
 * Fedify's error hook sees no inbox for a transport error (a refused connection), and it has no
 * success hook at all, so each outbox attempt runs in an async context that carries its inbox: a
 * failure is recorded against that host, and an attempt that neither failed nor was put back on the
 * queue (a circuit-breaker hold) clears it.
 */
export const createDeliveryObserver = (deps: DeliveryObserverDeps): DeliveryObserver => {
  const attempts = new AsyncLocalStorage<AttemptState>()
  const logError = deps.logError ?? ((message, error) => console.error(message, error))

  const recordFailure = async (inbox: string, status: number | null, line: string) => {
    const host = hostOf(inbox)
    if (host == null) return
    try {
      await deps.store.recordDeliveryFailure({
        inbox_host: host,
        last_error: line,
        last_inbox: inbox,
        last_status: status,
      })
    } catch (error) {
      logError(`⚠️ Could not record the delivery failure for ${host}:`, error)
    }
  }

  return {
    observe: (queue) => ({
      enqueue: (message: unknown, options?: MessageQueueEnqueueOptions) => {
        const state = attempts.getStore()
        if (state != null) state.requeued = true
        return queue.enqueue(message, options)
      },
      ...(queue.enqueueMany == null ? {} : { enqueueMany: queue.enqueueMany.bind(queue) }),
      listen: (handler: (message: unknown) => Promise<void> | void, options?: MessageQueueListenOptions) =>
        queue.listen(async (message: unknown) => {
          if (!isOutboxMessage(message)) return await handler(message)
          const state: AttemptState = { failed: false, inbox: message.inbox, requeued: false }
          await attempts.run(state, async () => await handler(message))
          if (state.failed || state.requeued) return
          const host = hostOf(message.inbox)
          if (host == null) return
          await deps.store.recordDeliverySuccess(host).catch((error: unknown) => {
            logError(`⚠️ Could not record the delivery success for ${host}:`, error)
          })
        }, options),
      nativeRetrial: queue.nativeRetrial,
    }),

    onOutboxError: async (error) => {
      const state = attempts.getStore()
      if (state != null) state.failed = true
      const inbox = error instanceof SendActivityError ? error.inbox.href : state?.inbox
      if (inbox == null) return
      const { line, status } = deliveryErrorLine(error)
      await recordFailure(inbox, status, line)
    },

    onPermanentFailure: async (_ctx, values) => {
      const state = attempts.getStore()
      if (state != null) state.failed = true
      if (values.reason === 'circuit-breaker-ttl') {
        await recordFailure(values.inbox.href, null, 'Gave up: the server stayed unreachable')
      }
    },
  }
}

/** What `createFeedFederation` needs to deliver through the queue instead of synchronously. */
export interface QueuedDelivery {
  options: Pick<
    FederationOptions<void>,
    | 'circuitBreaker'
    | 'manuallyStartQueue'
    | 'onOutboxError'
    | 'outboxRetryPolicy'
    | 'permanentFailureStatusCodes'
    | 'queue'
  >
  onPermanentFailure: OutboxPermanentFailureHandler<void>
}

export interface QueuedDeliveryDeps extends DeliveryObserverDeps {
  boss: Parameters<typeof createPgBossMessageQueue>[0]
  retryPolicy?: RetryPolicy
  queueOptions?: PgBossMessageQueueOptions
}

/**
 * Outbound activities (and their fan-out) go through pg-boss; inbound ones are still processed
 * as they arrive, since no inbox queue is set.
 */
export const createQueuedDelivery = async (deps: QueuedDeliveryDeps): Promise<QueuedDelivery> => {
  const observer = createDeliveryObserver(deps)
  const [outbox, fanout] = await Promise.all([
    createPgBossMessageQueue(deps.boss, OUTBOX_QUEUE, deps.queueOptions),
    createPgBossMessageQueue(deps.boss, FANOUT_QUEUE, deps.queueOptions),
  ])
  return {
    onPermanentFailure: observer.onPermanentFailure,
    options: {
      circuitBreaker: { heldActivityTtl: CIRCUIT_HELD_ACTIVITY_TTL },
      manuallyStartQueue: true,
      onOutboxError: observer.onOutboxError,
      outboxRetryPolicy: deps.retryPolicy ?? deliveryRetryPolicy(),
      permanentFailureStatusCodes: PERMANENT_FAILURE_STATUS_CODES,
      queue: { fanout, outbox: observer.observe(outbox) },
    },
  }
}

/**
 * The one place that decides how the federation delivers: through the queue when pg-boss is up,
 * else synchronously as before. Logs which.
 */
export const federationDelivery = async (
  boss: PgBoss | null,
  store: DeliveryObserverDeps['store'],
  log: (message: string) => void = (message) => console.info(message),
): Promise<QueuedDelivery | null> => {
  if (boss == null) {
    log('📮 Federation delivery: synchronous (no job queue), failed deliveries are not retried')
    return null
  }
  try {
    const delivery = await createQueuedDelivery({ boss, store })
    log('📮 Federation delivery: queued on pg-boss, failed deliveries retried with backoff')
    return delivery
  } catch (error) {
    console.error('Failed to initialize the federation delivery queue:', error)
    log('📮 Federation delivery: synchronous (queue setup failed), failed deliveries are not retried')
    return null
  }
}
