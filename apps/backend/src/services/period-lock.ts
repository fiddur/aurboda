/**
 * Period locks: what a visitor of a published period dashboard may see. `latest` shows the most recently
 * finished period, `fixed` the one in `period_fixed`, and `browsable` any finished period from
 * `period_from` on.
 */
import type { DashboardConfig, PeriodLock } from '@aurboda/api-spec'

import { comparePeriodKeys, periodGranularityOf } from '@aurboda/api-spec'

import { isFinishedPeriod, latestFinishedPeriodKey, PeriodError } from './periods.ts'

export interface PeriodLockState {
  period_fixed: string | null
  period_from: string | null
  period_lock: PeriodLock
}

export interface PeriodLockRequest {
  period_fixed?: string | null
  period_from?: string | null
  period_lock?: PeriodLock
}

export const defaultPeriodLock: PeriodLockState = {
  period_fixed: null,
  period_from: null,
  period_lock: 'latest',
}

/** The lock a request sets, keeping only the key its mode uses; undefined when it sends no `period_lock`. */
export const requestedPeriodLock = (request: PeriodLockRequest): PeriodLockState | undefined =>
  request.period_lock === undefined
    ? undefined
    : {
        period_fixed: request.period_lock === 'fixed' ? (request.period_fixed ?? null) : null,
        period_from: request.period_lock === 'browsable' ? (request.period_from ?? null) : null,
        period_lock: request.period_lock,
      }

/** Why `lock` cannot go with `config`, or null when it can. */
export const validatePeriodLock = (config: DashboardConfig, lock: PeriodLockState): string | null => {
  if (lock.period_lock === 'latest') return null
  const granularity = config.period?.granularity
  if (!granularity) return `A ${lock.period_lock} period lock needs a period dashboard`
  const field = lock.period_lock === 'fixed' ? 'period_fixed' : 'period_from'
  const key = lock[field]
  if (key === null) return `A ${lock.period_lock} period lock needs ${field}`
  const keyGranularity = periodGranularityOf(key)
  if (keyGranularity === null) return `${field} is not a valid period`
  if (keyGranularity !== granularity) {
    return `${field} is a ${keyGranularity}, but the dashboard shows ${granularity}s`
  }
  return null
}

/**
 * The lock and config an update would leave, validated together: the stored lock stands when the request
 * sends no `period_lock`, so a config change cannot strand a key of another granularity.
 */
export const resolveLockUpdate = (
  stored: { config: DashboardConfig } & PeriodLockState,
  request: PeriodLockRequest & { config?: DashboardConfig },
): { error: string } | { lock: PeriodLockState | undefined } => {
  const lock = requestedPeriodLock(request)
  const error = validatePeriodLock(request.config ?? stored.config, lock ?? stored)
  return error === null ? { lock } : { error }
}

/**
 * The period a visitor sees: undefined on a rolling dashboard. `requested` counts only on a browsable
 * dashboard, where it must be a finished period of the granularity from `period_from` on.
 */
export const publicPeriodFor = (
  record: { config: DashboardConfig } & PeriodLockState,
  requested: string | undefined,
  now: Date,
  tz: string,
): string | undefined => {
  const granularity = record.config.period?.granularity
  if (!granularity) return undefined
  if (record.period_lock === 'fixed' && record.period_fixed !== null) return record.period_fixed
  const latest = latestFinishedPeriodKey(granularity, now, tz)
  if (record.period_lock !== 'browsable') return latest

  const period = requested ?? latest
  const periodGranularity = periodGranularityOf(period)
  if (periodGranularity === null) throw new PeriodError('invalid')
  if (periodGranularity !== granularity) throw new PeriodError('granularity_mismatch')
  if (!isFinishedPeriod(period, now, tz)) throw new PeriodError('not_finished')
  if (record.period_from !== null && comparePeriodKeys(period, record.period_from) < 0) {
    throw new PeriodError('before_period_from')
  }
  return period
}
