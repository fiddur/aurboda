/**
 * Before #1153 a failed Garmin login could copy the submitted password into
 * the audit log: the error text in the client's and the route's own entries,
 * and the 401 response body in the request entry. This one-shot, per-user
 * cleanup drops those fields. Completion is recorded via `sync_state`
 * (provider='aurboda', data_type='garmin_login_audit_redaction').
 */

import { query } from '../db/connection.ts'
import { getSyncState, upsertSyncState } from '../db/index.ts'

const DATA_TYPE = 'garmin_login_audit_redaction'

export const redactGarminLoginAudit = async (
  user: string,
): Promise<{ redacted: number; skipped: boolean }> => {
  const state = await getSyncState(user, 'aurboda', DATA_TYPE)
  if (state?.status === 'idle' && state.last_sync_time) return { redacted: 0, skipped: true }

  const errors = await query(
    user,
    `UPDATE audit_log SET details = details - 'error'
      WHERE message IN ('Garmin login failed', 'Garmin login endpoint error') AND details ? 'error'`,
  )
  const responses = await query(
    user,
    `UPDATE audit_log SET details = details - 'response'
      WHERE message LIKE 'POST %auth/garmin/login' AND details ? 'response'`,
  )

  await upsertSyncState(user, {
    data_type: DATA_TYPE,
    last_sync_time: new Date(),
    provider: 'aurboda',
    status: 'idle',
  })
  return { redacted: (errors.rowCount ?? 0) + (responses.rowCount ?? 0), skipped: false }
}
