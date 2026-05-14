/**
 * Sentry initialization. DSN is read from server_settings at startup —
 * admins configure it via Admin Settings. Changes take effect on the next
 * backend restart (Sentry SDK is initialized once per process).
 */
import * as Sentry from '@sentry/node'

import type { CentralDb } from './central-db.ts'

let initialized = false

export const initSentry = async (centralDb: CentralDb): Promise<boolean> => {
  if (initialized) return true
  const dsn = await centralDb.getServerSetting('sentry_dsn')
  if (!dsn) return false
  Sentry.init({
    dsn,
    sendDefaultPii: true,
  })
  initialized = true
  console.info('🛡️ Sentry error reporting enabled')
  return true
}

export { Sentry }
