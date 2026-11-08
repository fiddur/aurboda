import type { PeriodLock, SharedDashboard, UpdateSharedDashboardBody } from '@aurboda/api-spec'

export interface PeriodLockDraft {
  mode: PeriodLock
  fixed: string
  from: string
  /** The owner ticked "Visitors can see every finished period from … on". */
  confirmed: boolean
}

export const PERIOD_LOCK_OPTIONS: { label: string; value: PeriodLock }[] = [
  { label: 'Latest finished period', value: 'latest' },
  { label: 'Fixed period', value: 'fixed' },
  { label: 'Browsable', value: 'browsable' },
]

type StoredLock = Pick<SharedDashboard, 'period_fixed' | 'period_from' | 'period_lock'>

/** Only a published period dashboard has a lock to set. */
export const hasPeriodLock = (dashboard: Pick<SharedDashboard, 'config' | 'visibility'>): boolean =>
  dashboard.config.period !== undefined && dashboard.visibility !== 'private'

export const initialDraft = (stored: StoredLock, latest: string): PeriodLockDraft => ({
  confirmed: stored.period_lock === 'browsable',
  fixed: stored.period_fixed ?? latest,
  from: stored.period_from ?? latest,
  mode: stored.period_lock,
})

export const lockBody = (draft: PeriodLockDraft): UpdateSharedDashboardBody =>
  draft.mode === 'fixed'
    ? { period_fixed: draft.fixed, period_lock: 'fixed' }
    : draft.mode === 'browsable'
      ? { period_from: draft.from, period_lock: 'browsable' }
      : { period_lock: 'latest' }

const storedBody = (stored: StoredLock): UpdateSharedDashboardBody =>
  stored.period_lock === 'fixed'
    ? { period_fixed: stored.period_fixed, period_lock: 'fixed' }
    : stored.period_lock === 'browsable'
      ? { period_from: stored.period_from, period_lock: 'browsable' }
      : { period_lock: 'latest' }

export const isDirty = (draft: PeriodLockDraft, stored: StoredLock): boolean =>
  JSON.stringify(lockBody(draft)) !== JSON.stringify(storedBody(stored))

/** A changed lock saves; a browsable one only once the owner has confirmed what it exposes. */
export const canSave = (draft: PeriodLockDraft, stored: StoredLock): boolean =>
  isDirty(draft, stored) && (draft.mode !== 'browsable' || draft.confirmed)

/** Picking browsable or moving its earliest period asks for the confirmation again. */
export const withMode = (draft: PeriodLockDraft, mode: PeriodLock): PeriodLockDraft => ({
  ...draft,
  confirmed: mode === 'browsable' && draft.mode === 'browsable' ? draft.confirmed : false,
  mode,
})

export const withFrom = (draft: PeriodLockDraft, from: string): PeriodLockDraft => ({
  ...draft,
  confirmed: from === draft.from ? draft.confirmed : false,
  from,
})
