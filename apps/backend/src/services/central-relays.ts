import type { RelayState, RelayStyle } from '@aurboda/api-spec'

import { generateKeyPair } from 'node:crypto'
import { promisify } from 'node:util'

import type { Queryable } from '../db/pool.ts'

const generateKeyPairAsync = promisify(generateKeyPair)

/** The instance actor's key pair: the server itself, as the sender of relay follows. */
export const CREATE_INSTANCE_ACTOR_TABLE = `
  CREATE TABLE IF NOT EXISTS instance_actor (
    singleton       BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    private_key_pem TEXT NOT NULL,
    public_key_pem  TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

export const CREATE_RELAYS_TABLE = `
  CREATE TABLE IF NOT EXISTS relays (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url                TEXT NOT NULL UNIQUE,
    style              TEXT NOT NULL CHECK (style IN ('mastodon', 'litepub')),
    inbox_uri          TEXT NOT NULL,
    actor_uri          TEXT,
    state              TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'rejected')),
    follow_activity_id TEXT NOT NULL UNIQUE,
    last_error         TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

export interface InstanceActorKeyPair {
  private_key_pem: string
  public_key_pem: string
  created_at: Date
}

export interface RelayRecord {
  id: string
  url: string
  style: RelayStyle
  inbox_uri: string
  actor_uri: string | null
  state: RelayState
  follow_activity_id: string
  last_error: string | null
  created_at: Date
  updated_at: Date
}

export interface RelayInput {
  id: string
  url: string
  style: RelayStyle
  inbox_uri: string
  actor_uri: string | null
  follow_activity_id: string
}

export interface RelaysApi {
  /** Generated and stored on first use; a concurrent first call keeps whichever pair landed first. */
  getOrCreateInstanceActorKeyPair: () => Promise<InstanceActorKeyPair>
  listRelays: () => Promise<RelayRecord[]>
  listAcceptedRelays: () => Promise<RelayRecord[]>
  getRelay: (id: string) => Promise<RelayRecord | null>
  getRelayByUrl: (url: string) => Promise<RelayRecord | null>
  getRelayByFollowActivityId: (followActivityId: string) => Promise<RelayRecord | null>
  getRelayByActorUri: (actorUri: string) => Promise<RelayRecord | null>
  insertRelay: (input: RelayInput) => Promise<RelayRecord>
  setRelayState: (
    id: string,
    state: RelayState,
    fields?: { actor_uri?: string | null; last_error?: string | null },
  ) => Promise<RelayRecord | null>
  /** Records a delivery error without touching the state, which an Accept may have moved meanwhile. */
  setRelayError: (id: string, lastError: string) => Promise<RelayRecord | null>
  deleteRelay: (id: string) => Promise<boolean>
}

const RELAY_COLUMNS =
  'id, url, style, inbox_uri, actor_uri, state, follow_activity_id, last_error, created_at, updated_at'

const selectInstanceKeys = async (client: Queryable): Promise<InstanceActorKeyPair | null> => {
  const result = await client.query<InstanceActorKeyPair>(
    'SELECT private_key_pem, public_key_pem, created_at FROM instance_actor WHERE singleton = true',
  )
  return result.rows[0] ?? null
}

const relayWhere =
  (getClient: () => Promise<Queryable>, column: string) =>
  async (value: string): Promise<RelayRecord | null> => {
    const client = await getClient()
    const result = await client.query<RelayRecord>(
      `SELECT ${RELAY_COLUMNS} FROM relays WHERE ${column} = $1`,
      [value],
    )
    return result.rows[0] ?? null
  }

export const createRelaysApi = (getClient: () => Promise<Queryable>): RelaysApi => ({
  deleteRelay: async (id) => {
    const client = await getClient()
    const result = await client.query('DELETE FROM relays WHERE id = $1', [id])
    return (result.rowCount ?? 0) > 0
  },

  getOrCreateInstanceActorKeyPair: async () => {
    const client = await getClient()
    const existing = await selectInstanceKeys(client)
    if (existing != null) return existing
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
      publicKeyEncoding: { format: 'pem', type: 'spki' },
    })
    await client.query(
      `INSERT INTO instance_actor (singleton, private_key_pem, public_key_pem)
       VALUES (true, $1, $2)
       ON CONFLICT (singleton) DO NOTHING`,
      [privateKey, publicKey],
    )
    const stored = await selectInstanceKeys(client)
    if (stored == null) throw new Error('Instance actor key pair was not stored')
    return stored
  },

  getRelay: relayWhere(getClient, 'id'),
  getRelayByActorUri: relayWhere(getClient, 'actor_uri'),
  getRelayByFollowActivityId: relayWhere(getClient, 'follow_activity_id'),
  getRelayByUrl: relayWhere(getClient, 'url'),

  insertRelay: async (input) => {
    const client = await getClient()
    const result = await client.query<RelayRecord>(
      `INSERT INTO relays (id, url, style, inbox_uri, actor_uri, state, follow_activity_id)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       RETURNING ${RELAY_COLUMNS}`,
      [input.id, input.url, input.style, input.inbox_uri, input.actor_uri, input.follow_activity_id],
    )
    return result.rows[0]
  },

  listAcceptedRelays: async () => {
    const client = await getClient()
    const result = await client.query<RelayRecord>(
      `SELECT ${RELAY_COLUMNS} FROM relays WHERE state = 'accepted' ORDER BY created_at`,
    )
    return result.rows
  },

  listRelays: async () => {
    const client = await getClient()
    const result = await client.query<RelayRecord>(`SELECT ${RELAY_COLUMNS} FROM relays ORDER BY created_at`)
    return result.rows
  },

  setRelayError: async (id, lastError) => {
    const client = await getClient()
    const result = await client.query<RelayRecord>(
      `UPDATE relays SET last_error = $2, updated_at = NOW() WHERE id = $1 RETURNING ${RELAY_COLUMNS}`,
      [id, lastError],
    )
    return result.rows[0] ?? null
  },

  setRelayState: async (id, state, fields = {}) => {
    const client = await getClient()
    const result = await client.query<RelayRecord>(
      `UPDATE relays
       SET state = $2,
           actor_uri = CASE WHEN $3::boolean THEN $4 ELSE actor_uri END,
           last_error = CASE WHEN $5::boolean THEN $6 ELSE last_error END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${RELAY_COLUMNS}`,
      [
        id,
        state,
        'actor_uri' in fields,
        fields.actor_uri ?? null,
        'last_error' in fields,
        fields.last_error ?? null,
      ],
    )
    return result.rows[0] ?? null
  },
})
