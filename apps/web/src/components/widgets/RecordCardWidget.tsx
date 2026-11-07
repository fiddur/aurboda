import { activityMeasureLabels, type RecordCardConfig, type RecordCardData } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'

import { fetchActivityRecords } from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import { formatMeasure } from '../../utils/measures'
import { RecordDetail } from '../RecordCard'
import { HEAVY_QUERY_OPTIONS } from './heavyQuery'

const DAY_MS = 86_400_000

const recordCardTitle = ({ filter_value, measure, pattern, title }: RecordCardConfig): string =>
  title ?? `${filter_value ?? toDisplayName(pattern)} · ${activityMeasureLabels[measure]}`

interface RecordCardViewProps {
  config: RecordCardConfig
  data: RecordCardData | null
  loading?: boolean
}

export function RecordCardView({ config, data, loading = false }: RecordCardViewProps) {
  const record = data?.record ?? null
  return (
    <div class="metric-card record-card">
      <div class="metric-header">
        <span class="metric-title">{recordCardTitle(config)}</span>
      </div>
      <div class="metric-value">
        {loading ? (
          <span class="loading-placeholder">...</span>
        ) : record ? (
          <span class="value">{formatMeasure(record.measure, record.value)}</span>
        ) : (
          <span class="no-data">No record yet</span>
        )}
      </div>
      {record && (
        <div class="metric-subtitle">
          <RecordDetail record={record} />
        </div>
      )}
    </div>
  )
}

export function RecordCardWidget({ config }: { config: RecordCardConfig }) {
  const { filter_field, filter_value, lookback_days, measure, pattern } = config

  const query = useQuery({
    queryFn: () =>
      fetchActivityRecords(pattern, {
        ...(filter_field !== undefined && filter_value !== undefined ? { filter_field, filter_value } : {}),
        ...(lookback_days !== undefined
          ? { start: new Date(Date.now() - lookback_days * DAY_MS).toISOString() }
          : {}),
      }),
    queryKey: ['activity-records', pattern, filter_field, filter_value, lookback_days],
    ...HEAVY_QUERY_OPTIONS,
    staleTime: 5 * 60 * 1000,
  })

  const record = query.data?.records.find((r) => r.measure === measure) ?? null

  return <RecordCardView config={config} data={query.data ? { record } : null} loading={query.isLoading} />
}
