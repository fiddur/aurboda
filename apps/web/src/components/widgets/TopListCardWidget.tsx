import type { TopListCardConfig, TopListCardData } from '@aurboda/api-spec'

import {
  percentChange,
  topListFromApps,
  topListFromMedia,
  topListFromPlaces,
  windowDays,
} from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'

import { fetchPlacesSummary, fetchTopApps, fetchTopMedia } from '../../state/api'
import { browserTz } from '../../state/api/client'
import { HEAVY_QUERY_OPTIONS } from './heavyQuery'
import { formatDistinct, formatItemCount, formatNumber, topListTitle, totalUnit } from './topListCard'
import { TrendIndicator } from './TrendIndicator'

const DAY_MS = 86_400_000

const mediaGrouping = { media_album: 'album', media_artist: 'artist', media_track: 'track' } as const

interface TopListCardViewProps {
  config: TopListCardConfig
  data: TopListCardData | null
  loading?: boolean
}

const Headline = ({ data, loading }: { data: TopListCardData | null; loading: boolean }) => {
  if (loading) return <span class="loading-placeholder">...</span>
  if (!data) return <span class="no-data">No data</span>
  return (
    <>
      <span class="value">{formatNumber(data.total)}</span>
      <span class="unit">{totalUnit(data.unit)}</span>
    </>
  )
}

const Subline = ({ config, data }: { config: TopListCardConfig; data: TopListCardData }) => {
  const parts = [
    ...(data.per_day === null ? [] : [`${formatNumber(data.per_day)} h/day`]),
    ...(data.distinct === null ? [] : [formatDistinct(data.distinct, config.source)]),
  ]
  return parts.length === 0 ? null : <div class="metric-subtitle">{parts.join(' · ')}</div>
}

export function TopListCardView({ config, data, loading = false }: TopListCardViewProps) {
  return (
    <div class="metric-card top-list-card">
      <div class="metric-header">
        <span class="metric-title">{topListTitle(config)}</span>
        {data && data.previous_total !== undefined && (
          <TrendIndicator value={percentChange(data.total, data.previous_total)} />
        )}
      </div>
      <div class="metric-value">
        <Headline data={data} loading={loading} />
      </div>
      {data && <Subline config={config} data={data} />}
      {data && data.items.length > 0 && (
        <ol class="top-list-card-items">
          {data.items.map((item) => (
            <li key={item.name} class="activity-type-card-row">
              <span class="activity-type-card-label top-list-card-name">{item.name}</span>
              <span class="activity-type-card-value">{formatItemCount(item.count, data.unit)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

const fetchTopList = async (config: TopListCardConfig, start: Date, end: Date) => {
  const range = { end: end.toISOString(), start: start.toISOString() }
  switch (config.source) {
    case 'media_artist':
    case 'media_album':
    case 'media_track': {
      const top = await fetchTopMedia({
        ...range,
        by: mediaGrouping[config.source],
        limit: config.limit,
        source: config.media_source,
      })
      return top && topListFromMedia(top)
    }
    case 'screentime_app': {
      const top = await fetchTopApps({ ...range, limit: config.limit })
      return top && topListFromApps(top, windowDays(start, end))
    }
    case 'place': {
      const summary = await fetchPlacesSummary({ ...range, tz: browserTz })
      return summary && topListFromPlaces(summary, config.limit)
    }
  }
}

export function TopListCardWidget({ config }: { config: TopListCardConfig }) {
  const { limit, lookback_days = 30, media_source, source } = config

  const query = useQuery({
    queryFn: () => {
      const end = new Date()
      return fetchTopList(config, new Date(end.getTime() - lookback_days * DAY_MS), end)
    },
    queryKey: ['top-list-card', source, media_source, limit, lookback_days],
    ...HEAVY_QUERY_OPTIONS,
    staleTime: 5 * 60 * 1000,
  })

  return <TopListCardView config={config} data={query.data ?? null} loading={query.isLoading} />
}
