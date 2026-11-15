import type { Federation } from '@fedify/fedify'
import type { AddressInfo } from 'node:net'

import { Follow } from '@fedify/fedify/vocab'
import { generateKeyPairSync } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import * as PgBossModule from 'pg-boss'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import type { PgBoss } from '../pg-boss.ts'

import { getTestConnectionUri, getTestDbClient, startTestDb, stopTestDb } from '../../test/db-test-helper.ts'
import {
  createFederationDeliveryFailuresApi,
  CREATE_FEDERATION_DELIVERY_FAILURES_TABLE,
  type FederationDeliveryFailureRecord,
} from '../central-federation-delivery.ts'
import { createQueuedDelivery, OUTBOX_QUEUE } from './delivery-queue.ts'
import { createFeedFederation } from './federation.ts'
import { INSTANCE_ACTOR_ID } from './instance-actor.ts'

const SETUP_TIMEOUT = 120_000
const ORIGIN = 'https://aurboda.test'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
})

/**
 * An inbox whose answers are scripted: each POST takes the next status, the last one repeating.
 * Fedify knocks twice per attempt when the first POST fails (one per HTTP signature spec), so an
 * attempt that fails is two POSTs.
 */
const scriptedInbox = async (statuses: number[]) => {
  const received: string[] = []
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      received.push(body)
      const status = statuses[Math.min(received.length - 1, statuses.length - 1)]
      res.writeHead(status).end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    host: `127.0.0.1:${port}`,
    inbox: `http://127.0.0.1:${port}/inbox`,
    received,
  }
}

const waitFor = async <T>(probe: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value != null) return value
    if (Date.now() > deadline) throw new Error('Timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

describe('queued federation delivery', () => {
  let boss: PgBoss
  let federation: Federation<void>
  const abort = new AbortController()

  const failureRow = async (host: string): Promise<FederationDeliveryFailureRecord | null> => {
    const result = await getTestDbClient().query<FederationDeliveryFailureRecord>(
      'SELECT * FROM federation_delivery_failures WHERE inbox_host = $1',
      [host],
    )
    return result.rows[0] ?? null
  }

  const pendingOutboxJobs = async (): Promise<number> => {
    const result = await getTestDbClient().query<{ n: string }>(
      `SELECT count(*) AS n FROM pgboss.job WHERE name = $1 AND state IN ('created', 'retry', 'active')`,
      [OUTBOX_QUEUE],
    )
    return Number(result.rows[0].n)
  }

  const send = async (inbox: string, n: number) => {
    const ctx = federation.createContext(new URL(ORIGIN))
    await ctx.sendActivity(
      { identifier: INSTANCE_ACTOR_ID },
      { id: new URL(inbox.replace('/inbox', '/actor')), inboxId: new URL(inbox) },
      new Follow({
        actor: ctx.getActorUri(INSTANCE_ACTOR_ID),
        id: new URL(`${ORIGIN}/actor/follows/${n}`),
        object: new URL(inbox.replace('/inbox', '/actor')),
      }),
    )
  }

  beforeAll(async () => {
    await startTestDb()
    await getTestDbClient().query(CREATE_FEDERATION_DELIVERY_FAILURES_TABLE)
    boss = new PgBossModule.PgBoss(getTestConnectionUri())
    await boss.start()
    const delivery = await createQueuedDelivery({
      boss,
      queueOptions: { pollingIntervalSeconds: 0.5 },
      retryPolicy: ({ attempts }) => (attempts < 3 ? Temporal.Duration.from({ milliseconds: 300 }) : null),
      store: createFederationDeliveryFailuresApi(async () => getTestDbClient()),
    })
    federation = createFeedFederation(
      ORIGIN,
      `${ORIGIN}/api`,
      undefined,
      undefined,
      'dev',
      undefined,
      undefined,
      undefined,
      {
        instanceKeys: async () => ({ private_key_pem: privateKey, public_key_pem: publicKey }),
        relays: { isRelayActor: async () => false, onAccept: async () => false, onReject: async () => false },
      },
      delivery,
    )
    void federation.startQueue(undefined, { signal: abort.signal })
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    abort.abort()
    await boss?.stop({ graceful: false })
    await stopTestDb()
  })

  test('an inbox that fails once gets the activity on the retry, and its failure is cleared', async () => {
    const inbox = await scriptedInbox([503, 503, 202])
    try {
      await send(inbox.inbox, 1)
      await waitFor(async () => (inbox.received.length >= 3 ? true : null))
      expect(inbox.received).toHaveLength(3)
      expect(JSON.parse(inbox.received[2]).id).toBe(`${ORIGIN}/actor/follows/1`)
      const row = await waitFor(async () => {
        const r = await failureRow(inbox.host)
        return r?.last_succeeded_at != null ? r : null
      })
      expect(row).toMatchObject({ failures: 0, last_status: 503 })
    } finally {
      await inbox.close()
    }
  }, 30_000)

  test('an inbox that keeps failing is recorded with its status', async () => {
    const inbox = await scriptedInbox([503])
    try {
      await send(inbox.inbox, 2)
      const row = await waitFor(async () => {
        const r = await failureRow(inbox.host)
        return r != null && r.failures >= 2 ? r : null
      })
      expect(row).toMatchObject({
        last_error: 'HTTP 503 Service Unavailable',
        last_inbox: inbox.inbox,
        last_status: 503,
        last_succeeded_at: null,
      })
    } finally {
      await inbox.close()
    }
  }, 30_000)

  test('an inbox that answers 410 Gone is given up on at once', async () => {
    const inbox = await scriptedInbox([410])
    try {
      await send(inbox.inbox, 3)
      const row = await waitFor(async () => failureRow(inbox.host))
      expect(row).toMatchObject({ failures: 1, last_status: 410 })
      await waitFor(async () => ((await pendingOutboxJobs()) === 0 ? true : null))
      expect(inbox.received).toHaveLength(2)
    } finally {
      await inbox.close()
    }
  }, 30_000)
})
