import webpush from 'web-push'

import type { Queryable } from '../db/pool.ts'

const VAPID_SETTING_KEY = 'web_push_vapid_keys'

export interface VapidKeys {
  public_key: string
  private_key: string
}

export interface WebPushKeysApi {
  /** Generated and stored in `server_settings` on first use; a concurrent first call keeps whichever pair landed first. */
  getOrCreateVapidKeys: () => Promise<VapidKeys>
}

const isVapidKeys = (value: unknown): value is VapidKeys =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).public_key === 'string' &&
  typeof (value as Record<string, unknown>).private_key === 'string'

const selectVapidKeys = async (client: Queryable): Promise<VapidKeys | null> => {
  const result = await client.query<{ value: unknown }>('SELECT value FROM server_settings WHERE key = $1', [
    VAPID_SETTING_KEY,
  ])
  const value = result.rows[0]?.value
  return isVapidKeys(value) ? value : null
}

export const createWebPushKeysApi = (
  getClient: () => Promise<Queryable>,
  generate: () => VapidKeys = () => {
    const keys = webpush.generateVAPIDKeys()
    return { private_key: keys.privateKey, public_key: keys.publicKey }
  },
): WebPushKeysApi => ({
  getOrCreateVapidKeys: async () => {
    const client = await getClient()
    const existing = await selectVapidKeys(client)
    if (existing != null) return existing
    await client.query(
      `INSERT INTO server_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [VAPID_SETTING_KEY, JSON.stringify(generate())],
    )
    const stored = await selectVapidKeys(client)
    if (stored == null) throw new Error('Web Push key pair was not stored')
    return stored
  },
})
