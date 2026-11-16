import type { OidcClient, OidcPreset } from '@aurboda/api-spec'

import type { Queryable } from '../db/pool.ts'

export const CREATE_OIDC_PROVIDERS_TABLE = `
  CREATE TABLE IF NOT EXISTS oidc_providers (
    id                    VARCHAR(31) PRIMARY KEY,
    display_name          TEXT NOT NULL,
    issuer                TEXT NOT NULL,
    client_id             TEXT NOT NULL,
    client_secret         TEXT NOT NULL,
    allowed_email_domains TEXT[] NOT NULL DEFAULT '{}',
    allow_signup          BOOLEAN NOT NULL DEFAULT FALSE,
    preset                TEXT,
    enabled               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

export const CREATE_OIDC_LINKS_TABLE = `
  CREATE TABLE IF NOT EXISTS oidc_links (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id   VARCHAR(31) NOT NULL REFERENCES oidc_providers(id) ON DELETE CASCADE,
    issuer        TEXT NOT NULL,
    subject       TEXT NOT NULL,
    username      VARCHAR(255) NOT NULL,
    email         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    UNIQUE (issuer, subject)
  )
`

export const CREATE_OIDC_FLOWS_TABLE = `
  CREATE TABLE IF NOT EXISTS oidc_flows (
    state_hash    TEXT PRIMARY KEY,
    provider_id   VARCHAR(31) NOT NULL REFERENCES oidc_providers(id) ON DELETE CASCADE,
    nonce         TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    intent        TEXT NOT NULL CHECK (intent IN ('login', 'link')),
    username      VARCHAR(255),
    invitation    TEXT,
    verifier_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

export const ALTER_OIDC_FLOWS_COLUMNS = ['ALTER TABLE oidc_flows ADD COLUMN IF NOT EXISTS client TEXT']

export const CREATE_OIDC_CODES_TABLE = `
  CREATE TABLE IF NOT EXISTS oidc_codes (
    code_hash      TEXT PRIMARY KEY,
    kind           TEXT NOT NULL CHECK (kind IN ('login', 'signup', 'link')),
    username       VARCHAR(255),
    provider_id    VARCHAR(31) NOT NULL REFERENCES oidc_providers(id) ON DELETE CASCADE,
    issuer         TEXT NOT NULL,
    subject        TEXT NOT NULL,
    email          TEXT,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    name           TEXT,
    invitation     TEXT,
    verifier_hash  TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

export const CREATE_OIDC_INDEXES = [
  'CREATE INDEX IF NOT EXISTS oidc_links_username_idx ON oidc_links (username)',
  'CREATE INDEX IF NOT EXISTS oidc_flows_created_at_idx ON oidc_flows (created_at)',
  'CREATE INDEX IF NOT EXISTS oidc_codes_created_at_idx ON oidc_codes (created_at)',
]

export interface OidcProviderRecord {
  id: string
  display_name: string
  issuer: string
  client_id: string
  client_secret: string
  allowed_email_domains: string[]
  allow_signup: boolean
  preset: OidcPreset | null
  enabled: boolean
  created_at: Date
  updated_at: Date
}

export type OidcProviderInput = Omit<OidcProviderRecord, 'created_at' | 'updated_at'>

export type OidcProviderFields = Partial<Omit<OidcProviderInput, 'id'>>

export interface OidcLinkRecord {
  id: string
  provider_id: string
  provider_display_name: string
  issuer: string
  subject: string
  username: string
  email: string | null
  created_at: Date
  last_login_at: Date | null
}

export interface OidcLinkInput {
  provider_id: string
  issuer: string
  subject: string
  username: string
  email: string | null
}

export type OidcIntent = 'login' | 'link'

export interface OidcFlowRecord {
  state_hash: string
  provider_id: string
  nonce: string
  code_verifier: string
  intent: OidcIntent
  username: string | null
  invitation: string | null
  /** sha256 of the verifier `start` handed to the browser that began the flow. */
  verifier_hash: string
  /** Null for the web; 'app' sends the callback to the app's custom scheme. */
  client: OidcClient | null
  created_at: Date
}

export type OidcCodeKind = 'login' | 'signup' | 'link'

export interface OidcCodeRecord {
  code_hash: string
  kind: OidcCodeKind
  username: string | null
  provider_id: string
  issuer: string
  subject: string
  email: string | null
  email_verified: boolean
  name: string | null
  invitation: string | null
  verifier_hash: string
  created_at: Date
}

export interface OidcApi {
  listOidcProviders: () => Promise<OidcProviderRecord[]>
  getOidcProvider: (id: string) => Promise<OidcProviderRecord | null>
  /** Resolves to null when the id is taken. */
  insertOidcProvider: (input: OidcProviderInput) => Promise<OidcProviderRecord | null>
  updateOidcProvider: (id: string, fields: OidcProviderFields) => Promise<OidcProviderRecord | null>
  /** Deletes the provider with its links, flows and codes. Resolves to the links removed, or null when there was no such provider. */
  deleteOidcProvider: (id: string) => Promise<number | null>
  /** Resolves to null when the (issuer, subject) is linked already. */
  insertOidcLink: (input: OidcLinkInput) => Promise<OidcLinkRecord | null>
  getOidcLinkBySubject: (issuer: string, subject: string) => Promise<OidcLinkRecord | null>
  listOidcLinksForUser: (username: string) => Promise<OidcLinkRecord[]>
  listOidcLinksForProvider: (providerId: string) => Promise<OidcLinkRecord[]>
  countOidcLinks: (username: string) => Promise<number>
  deleteOidcLink: (username: string, id: string) => Promise<boolean>
  recordOidcLogin: (id: string, email: string | null, at: Date) => Promise<void>
  saveOidcFlow: (flow: OidcFlowRecord) => Promise<void>
  /** Single use: the row is deleted as it is read. */
  takeOidcFlow: (stateHash: string) => Promise<OidcFlowRecord | null>
  saveOidcCode: (code: OidcCodeRecord) => Promise<void>
  /** Single use: the row is deleted as it is read. */
  takeOidcCode: (codeHash: string) => Promise<OidcCodeRecord | null>
  peekOidcCode: (codeHash: string) => Promise<OidcCodeRecord | null>
  /** Deletes the flows created before `flowsBefore` and the codes created before `codesBefore`. */
  pruneOidcFlows: (flowsBefore: Date, codesBefore: Date) => Promise<void>
}

const PROVIDER_COLUMNS =
  'id, display_name, issuer, client_id, client_secret, allowed_email_domains, allow_signup, preset, enabled, created_at, updated_at'

const LINK_COLUMNS =
  'l.id, l.provider_id, p.display_name AS provider_display_name, l.issuer, l.subject, l.username, l.email, l.created_at, l.last_login_at'

const FLOW_COLUMNS =
  'state_hash, provider_id, nonce, code_verifier, intent, username, invitation, verifier_hash, client, created_at'

const CODE_COLUMNS =
  'code_hash, kind, username, provider_id, issuer, subject, email, email_verified, name, invitation, verifier_hash, created_at'

const UPDATABLE = [
  'display_name',
  'issuer',
  'client_id',
  'client_secret',
  'allowed_email_domains',
  'allow_signup',
  'preset',
  'enabled',
] as const

const selectLinks = (where: string) =>
  `SELECT ${LINK_COLUMNS} FROM oidc_links l JOIN oidc_providers p ON p.id = l.provider_id WHERE ${where}`

export const createOidcApi = (
  getClient: () => Promise<Queryable>,
  withTransaction: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>,
): OidcApi => ({
  countOidcLinks: async (username) => {
    const client = await getClient()
    const result = await client.query<{ count: number }>(
      'SELECT COUNT(*)::integer AS count FROM oidc_links WHERE username = $1',
      [username],
    )
    return result.rows[0].count
  },

  deleteOidcLink: async (username, id) => {
    const client = await getClient()
    const result = await client.query('DELETE FROM oidc_links WHERE id = $1 AND username = $2', [
      id,
      username,
    ])
    return (result.rowCount ?? 0) > 0
  },

  deleteOidcProvider: (id) =>
    withTransaction(async (tx) => {
      const links = await tx.query('DELETE FROM oidc_links WHERE provider_id = $1', [id])
      const result = await tx.query('DELETE FROM oidc_providers WHERE id = $1', [id])
      return (result.rowCount ?? 0) > 0 ? (links.rowCount ?? 0) : null
    }),

  getOidcLinkBySubject: async (issuer, subject) => {
    const client = await getClient()
    const result = await client.query<OidcLinkRecord>(selectLinks('l.issuer = $1 AND l.subject = $2'), [
      issuer,
      subject,
    ])
    return result.rows[0] ?? null
  },

  getOidcProvider: async (id) => {
    const client = await getClient()
    const result = await client.query<OidcProviderRecord>(
      `SELECT ${PROVIDER_COLUMNS} FROM oidc_providers WHERE id = $1`,
      [id],
    )
    return result.rows[0] ?? null
  },

  insertOidcLink: async (input) => {
    const client = await getClient()
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO oidc_links (provider_id, issuer, subject, username, email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (issuer, subject) DO NOTHING
       RETURNING id`,
      [input.provider_id, input.issuer, input.subject, input.username, input.email],
    )
    if (inserted.rows.length === 0) return null
    const result = await client.query<OidcLinkRecord>(selectLinks('l.id = $1'), [inserted.rows[0].id])
    return result.rows[0] ?? null
  },

  insertOidcProvider: async (input) => {
    const client = await getClient()
    const result = await client.query<OidcProviderRecord>(
      `INSERT INTO oidc_providers
         (id, display_name, issuer, client_id, client_secret, allowed_email_domains, allow_signup, preset, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING
       RETURNING ${PROVIDER_COLUMNS}`,
      [
        input.id,
        input.display_name,
        input.issuer,
        input.client_id,
        input.client_secret,
        input.allowed_email_domains,
        input.allow_signup,
        input.preset,
        input.enabled,
      ],
    )
    return result.rows[0] ?? null
  },

  listOidcLinksForProvider: async (providerId) => {
    const client = await getClient()
    const result = await client.query<OidcLinkRecord>(
      `${selectLinks('l.provider_id = $1')} ORDER BY l.created_at`,
      [providerId],
    )
    return result.rows
  },

  listOidcLinksForUser: async (username) => {
    const client = await getClient()
    const result = await client.query<OidcLinkRecord>(
      `${selectLinks('l.username = $1')} ORDER BY l.created_at`,
      [username],
    )
    return result.rows
  },

  listOidcProviders: async () => {
    const client = await getClient()
    const result = await client.query<OidcProviderRecord>(
      `SELECT ${PROVIDER_COLUMNS} FROM oidc_providers ORDER BY created_at, id`,
    )
    return result.rows
  },

  peekOidcCode: async (codeHash) => {
    const client = await getClient()
    const result = await client.query<OidcCodeRecord>(
      `SELECT ${CODE_COLUMNS} FROM oidc_codes WHERE code_hash = $1`,
      [codeHash],
    )
    return result.rows[0] ?? null
  },

  pruneOidcFlows: async (flowsBefore, codesBefore) => {
    const client = await getClient()
    await client.query('DELETE FROM oidc_flows WHERE created_at < $1', [flowsBefore])
    await client.query('DELETE FROM oidc_codes WHERE created_at < $1', [codesBefore])
  },

  recordOidcLogin: async (id, email, at) => {
    const client = await getClient()
    await client.query(
      'UPDATE oidc_links SET last_login_at = $2, email = COALESCE($3, email) WHERE id = $1',
      [id, at, email],
    )
  },

  saveOidcCode: async (code) => {
    const client = await getClient()
    await client.query(
      `INSERT INTO oidc_codes (${CODE_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        code.code_hash,
        code.kind,
        code.username,
        code.provider_id,
        code.issuer,
        code.subject,
        code.email,
        code.email_verified,
        code.name,
        code.invitation,
        code.verifier_hash,
        code.created_at,
      ],
    )
  },

  saveOidcFlow: async (flow) => {
    const client = await getClient()
    await client.query(
      `INSERT INTO oidc_flows (${FLOW_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        flow.state_hash,
        flow.provider_id,
        flow.nonce,
        flow.code_verifier,
        flow.intent,
        flow.username,
        flow.invitation,
        flow.verifier_hash,
        flow.client,
        flow.created_at,
      ],
    )
  },

  takeOidcCode: async (codeHash) => {
    const client = await getClient()
    const result = await client.query<OidcCodeRecord>(
      `DELETE FROM oidc_codes WHERE code_hash = $1 RETURNING ${CODE_COLUMNS}`,
      [codeHash],
    )
    return result.rows[0] ?? null
  },

  takeOidcFlow: async (stateHash) => {
    const client = await getClient()
    const result = await client.query<OidcFlowRecord>(
      `DELETE FROM oidc_flows WHERE state_hash = $1 RETURNING ${FLOW_COLUMNS}`,
      [stateHash],
    )
    return result.rows[0] ?? null
  },

  updateOidcProvider: async (id, fields) => {
    const columns = UPDATABLE.filter((column) => fields[column] !== undefined)
    const assignments = [...columns.map((column, i) => `${column} = $${i + 2}`), 'updated_at = NOW()']
    const client = await getClient()
    const result = await client.query<OidcProviderRecord>(
      `UPDATE oidc_providers SET ${assignments.join(', ')} WHERE id = $1 RETURNING ${PROVIDER_COLUMNS}`,
      [id, ...columns.map((column) => fields[column])],
    )
    return result.rows[0] ?? null
  },
})
