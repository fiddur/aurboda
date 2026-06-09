/**
 * Fire-and-forget auto-sync for the correlation tools.
 *
 * Correlation analysis is retrospective over historical data, so it must never
 * block the response on live external syncs (Oura/RescueTime/calendars). A first
 * or stale sync can take many seconds — long enough to blow the MCP/HTTP request
 * timeout even for a tiny analysis window. We trigger the syncs in the
 * background so data is fresh for the *next* request, mirroring the pattern in
 * services/queries/productivity.ts.
 */

import type { SyncProvider } from '../queries/index.ts'

/**
 * Kick off the external syncs a correlation query benefits from, without
 * awaiting them. Each `*IfNeeded` sync already swallows its own errors, but we
 * attach a defensive catch so a rejected promise can never become an unhandled
 * rejection.
 */
export const triggerCorrelationSyncs = (sync: SyncProvider | undefined, user: string): void => {
  if (!sync) return
  void Promise.allSettled([
    sync.syncOuraIfNeeded(user, 'tags'),
    sync.syncOuraIfNeeded(user, 'sessions'),
    sync.syncRescueTimeIfNeeded(user),
    sync.syncCalendarsIfNeeded(user),
  ])
}
