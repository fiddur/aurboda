import type { SleepDebt, SleepDebtConfig } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'preact/hooks'

import { fetchSleepDebt } from '../../state/api'
import { formatMinutesAsHM } from '../charts/sleep-utils'
import { SparklineChart } from '../SparklineChart'
import { debtSeries, formatDebt, hasNights, SEVERITY_COLORS, SEVERITY_LABELS } from './sleepDebt'

interface SleepDebtViewProps {
  config: SleepDebtConfig
  data: SleepDebt | null
  loading?: boolean
}

export function SleepDebtView({ config, data, loading = false }: SleepDebtViewProps) {
  const title = config.title ?? 'Sleep debt'
  const days = data?.days
  const series = useMemo(() => debtSeries(days ?? []), [days])
  const shown = data && hasNights(data) ? data : null

  return (
    <div class="metric-card sleep-debt">
      <div class="metric-header">
        <span class="metric-title">{title}</span>
        {shown && (
          <span class="sleep-debt-severity" style={{ background: SEVERITY_COLORS[shown.severity] }}>
            {SEVERITY_LABELS[shown.severity]}
          </span>
        )}
      </div>
      <div class="metric-value">
        {loading ? (
          <span class="loading-placeholder">...</span>
        ) : shown ? (
          <span class="value">{formatDebt(shown.debt_minutes)}</span>
        ) : (
          <span class="no-data">No sleep recorded</span>
        )}
      </div>
      {shown && (
        <>
          <div class="metric-subtitle">Need {formatMinutesAsHM(shown.sleep_need_minutes)} a night</div>
          <div class="metric-sparkline">
            <SparklineChart data={series} color={SEVERITY_COLORS[shown.severity]} />
          </div>
        </>
      )}
    </div>
  )
}

export function SleepDebtWidget({ config }: { config: SleepDebtConfig }) {
  const query = useQuery({
    queryFn: () => fetchSleepDebt(),
    queryKey: ['sleepDebt'],
    staleTime: 5 * 60 * 1000,
  })

  return <SleepDebtView config={config} data={query.data ?? null} loading={query.isLoading} />
}
