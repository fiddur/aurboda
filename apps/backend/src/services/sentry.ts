/**
 * Sentry initialization. DSN is read from server_settings at startup —
 * admins configure it via Admin Settings. Changes take effect on the next
 * backend restart (Sentry SDK is initialized once per process).
 *
 * Scope is intentionally errors-only: because `Sentry.init` runs inside
 * `main()` after all module imports, OpenTelemetry-based auto-instrumentation
 * (HTTP/express/db tracing, automatic breadcrumbs) will not patch. Only the
 * explicit `setupExpressErrorHandler` path in `api.ts` captures errors.
 * Enabling tracing later would require `node --import ./instrument.ts` with
 * an env-bootstrapped DSN. See docs/sentry.md.
 */
import * as Sentry from '@sentry/node'

import type { CentralDb } from './central-db.ts'

export const initSentry = async (centralDb: CentralDb): Promise<boolean> => {
  const dsn = await centralDb.getServerSetting('sentry_dsn')
  if (!dsn) return false
  Sentry.init({
    dsn,
    sendDefaultPii: true,
  })
  console.info('🛡️ Sentry error reporting enabled')
  return true
}

export { Sentry }
