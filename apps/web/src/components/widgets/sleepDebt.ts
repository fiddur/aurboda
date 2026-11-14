import type { SleepDebt, SleepDebtDay, SleepDebtSeverity } from '@aurboda/api-spec'

import { formatMinutesAsHM } from '../charts/sleep-utils'

export const SEVERITY_LABELS: Record<SleepDebtSeverity, string> = {
  mild: 'Mild',
  moderate: 'Moderate',
  none: 'None',
  severe: 'Severe',
}

export const SEVERITY_COLORS: Record<SleepDebtSeverity, string> = {
  mild: '#eab308',
  moderate: '#f97316',
  none: '#22c55e',
  severe: '#ef4444',
}

export const formatDebt = (minutes: number): string => (minutes === 0 ? '0m' : formatMinutesAsHM(minutes))

/** Debt per date at local noon, for a time axis. */
export const debtSeries = (days: SleepDebtDay[]): [Date, number][] =>
  days.map((d) => [new Date(`${d.date}T12:00:00`), d.debt_minutes])

/** Whether any date in the range has a night recorded. */
export const hasNights = (debt: Pick<SleepDebt, 'days'>): boolean =>
  debt.days.some((d) => d.slept_minutes !== null)
