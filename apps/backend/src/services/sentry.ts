/**
 * Sentry initialization. DSN is read from server_settings at startup —
 * admins configure it via Admin Settings. Changes take effect on the next
 * backend restart (Sentry SDK is initialized once per process).
 *
 * Scope is intentionally errors-only, with no tracing: because `Sentry.init`
 * runs inside `main()` after all module imports, OpenTelemetry-based
 * auto-instrumentation (HTTP/express/db tracing, automatic breadcrumbs) will
 * not patch. Errors are captured from the explicit
 * `setupExpressErrorHandler` path plus the process-level guards in `api.ts`
 * (unhandled rejections, uncaught exceptions, startup and post-listen
 * failures). Enabling tracing later would require `node --import
 * ./instrument.ts` with an env-bootstrapped DSN. See docs/sentry.md.
 */
import * as Sentry from '@sentry/node'

import type { CentralDb } from './central-db.ts'

/**
 * Sentry's own process-level integrations, disabled because `api.ts` installs
 * its own handlers that capture and flush before exiting. Left enabled they
 * would capture the same crash a second time (they stop *exiting* once another
 * listener is registered, but still report), producing two events per crash.
 */
const OWN_PROCESS_HANDLER_INTEGRATIONS = ['OnUncaughtException', 'OnUnhandledRejection']

export const initSentry = async (centralDb: CentralDb): Promise<boolean> => {
  const dsn = await centralDb.getServerSetting('sentry_dsn')
  if (!dsn) return false
  Sentry.init({
    dsn,
    integrations: (defaults) =>
      defaults.filter((integration) => !OWN_PROCESS_HANDLER_INTEGRATIONS.includes(integration.name)),
    sendDefaultPii: true,
  })
  console.info('🛡️ Sentry error reporting enabled')
  return true
}

export { Sentry }
