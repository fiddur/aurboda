/**
 * Fire-and-forget auto-sync for the correlation tools.
 *
 * Correlation analysis is retrospective over historical data, so it must never
 * block the response on live external syncs (Oura/RescueTime/calendars). A first
 * or stale sync can take many seconds — long enough to blow the MCP/HTTP request
 * timeout even for a tiny analysis window. We trigger the syncs in the
 * background so data is fresh for the *next* request, as the query layer
 * already does (see services/queries/tags.ts and daily-summary.ts). We go one
 * step further and use Promise.allSettled so a rejected sync can never surface
 * as an unhandled rejection (those callers use a bare `void Promise.all`).
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
