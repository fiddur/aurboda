import type { FederationDeliveryFailure } from '@aurboda/api-spec'

import type { Queryable } from '../db/pool.ts'

/** `failures` counts the failed attempts since the host last accepted a delivery. */
export const CREATE_FEDERATION_DELIVERY_FAILURES_TABLE = `
  CREATE TABLE IF NOT EXISTS federation_delivery_failures (
    inbox_host        TEXT PRIMARY KEY,
    last_inbox        TEXT NOT NULL,
    last_status       INT,
    last_error        TEXT NOT NULL,
    failures          INT NOT NULL DEFAULT 0,
    first_failed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_failed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_succeeded_at TIMESTAMPTZ
  )
`

export interface FederationDeliveryFailureRecord {
  inbox_host: string
  last_inbox: string
  last_status: number | null
  last_error: string
  failures: number
  first_failed_at: Date
  last_failed_at: Date
  last_succeeded_at: Date | null
}

export interface FederationDeliveryFailureInput {
  inbox_host: string
  last_inbox: string
  last_status: number | null
  last_error: string
}

export interface FederationDeliveryFailuresApi {
  recordDeliveryFailure: (input: FederationDeliveryFailureInput) => Promise<void>
  recordDeliverySuccess: (inboxHost: string) => Promise<void>
  /** Hosts whose latest attempts failed, most recent failure first. */
  listFailingDeliveryHosts: (limit?: number) => Promise<FederationDeliveryFailureRecord[]>
}

const COLUMNS =
  'inbox_host, last_inbox, last_status, last_error, failures, first_failed_at, last_failed_at, last_succeeded_at'

const DEFAULT_LIST_LIMIT = 200

export const createFederationDeliveryFailuresApi = (
  getClient: () => Promise<Queryable>,
): FederationDeliveryFailuresApi => ({
  listFailingDeliveryHosts: async (limit = DEFAULT_LIST_LIMIT) => {
    const client = await getClient()
    const result = await client.query<FederationDeliveryFailureRecord>(
      `SELECT ${COLUMNS} FROM federation_delivery_failures
       WHERE failures > 0
       ORDER BY last_failed_at DESC
       LIMIT $1`,
      [limit],
    )
    return result.rows
  },

  recordDeliveryFailure: async (input) => {
    const client = await getClient()
    await client.query(
      `INSERT INTO federation_delivery_failures
         (inbox_host, last_inbox, last_status, last_error, failures, first_failed_at, last_failed_at)
       VALUES ($1, $2, $3, $4, 1, NOW(), NOW())
       ON CONFLICT (inbox_host) DO UPDATE SET
         last_inbox = EXCLUDED.last_inbox,
         last_status = EXCLUDED.last_status,
         last_error = EXCLUDED.last_error,
         first_failed_at = CASE
           WHEN federation_delivery_failures.failures = 0 THEN NOW()
           ELSE federation_delivery_failures.first_failed_at
         END,
         failures = federation_delivery_failures.failures + 1,
         last_failed_at = NOW()`,
      [input.inbox_host, input.last_inbox, input.last_status, input.last_error],
    )
  },

  recordDeliverySuccess: async (inboxHost) => {
    const client = await getClient()
    await client.query(
      `UPDATE federation_delivery_failures
       SET failures = 0, last_succeeded_at = NOW()
       WHERE inbox_host = $1 AND failures > 0`,
      [inboxHost],
    )
  },
})

export const serializeDeliveryFailure = (
  record: FederationDeliveryFailureRecord,
): FederationDeliveryFailure => ({
  failures: record.failures,
  first_failed_at: record.first_failed_at.toISOString(),
  inbox_host: record.inbox_host,
  last_error: record.last_error,
  last_failed_at: record.last_failed_at.toISOString(),
  last_inbox: record.last_inbox,
  last_status: record.last_status,
  last_succeeded_at: record.last_succeeded_at?.toISOString() ?? null,
})

/** Shared by the admin REST route and the admin MCP tool. */
export const listFederationDeliveryFailures = async (
  store: Pick<FederationDeliveryFailuresApi, 'listFailingDeliveryHosts'>,
): Promise<FederationDeliveryFailure[]> =>
  (await store.listFailingDeliveryHosts()).map(serializeDeliveryFailure)
