import type { GoalDayStatus, GoalHistoryDay, GoalHistoryMonth } from '@aurboda/api-spec'

export const statusColor: Record<GoalDayStatus, string> = {
  below: '#757575',
  met: '#4caf50',
  over: '#f44336',
}

export const trendLineColor = '#8b5cf6'
export const targetBandColor = 'rgba(76,175,80,0.15)'

const statusLabels: Record<GoalDayStatus, string> = {
  below: 'below target',
  met: 'on target',
  over: 'over target',
}

export const statusLabel = (status: GoalDayStatus): string => statusLabels[status]

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const monthName = (yyyyMm: string): string => monthNames[Number(yyyyMm.slice(5, 7)) - 1]

export const dayLabel = (date: string): string => `${monthName(date)} ${Number(date.slice(8, 10))}`

export const monthLabel = (month: string): string => `${monthName(month)} '${month.slice(2, 4)}`

export const yDomainTop = (dataMax: number, min?: number, max?: number): number =>
  Math.max(dataMax, max ?? min ?? 0) * 1.1 || 1

export const dayTooltip = (day: GoalHistoryDay, formatValue: (v: number) => string): string => {
  const label = day.partial ? `${dayLabel(day.date)} (today so far)` : dayLabel(day.date)
  const contribution = day.contribution === undefined ? '' : ` (day: ${formatValue(day.contribution)})`
  return `${label}: ${formatValue(day.value)}${contribution} · ${statusLabel(day.status)}`
}

export const monthTooltip = (month: GoalHistoryMonth): string => {
  const label = `${monthName(month.month)} ${month.month.slice(0, 4)}${month.partial ? ' (so far)' : ''}`
  const over = month.days_over > 0 ? ` · ${month.days_over} over` : ''
  return `${label}: ${month.days_met} of ${month.days_total} day${month.days_total === 1 ? '' : 's'} on target${over}`
}
