import type { PlacesCardConfig, PlacesCardData } from '@aurboda/api-spec'

import { percentChange } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'

import { fetchPlacesSummary } from '../../state/api'
import { browserTz } from '../../state/api/client'
import { HEAVY_QUERY_OPTIONS } from './heavyQuery'
import { formatNumber } from './topListCard'
import { TrendIndicator } from './TrendIndicator'

const DAY_MS = 86_400_000

const Figure = ({
  current,
  label,
  previous,
}: {
  current: number
  label: string
  previous?: number | null
}) => (
  <div class="activity-type-card-row">
    <span class="activity-type-card-label">{label}</span>
    <span class="activity-type-card-value">
      {formatNumber(current)}
      {previous !== undefined && <TrendIndicator value={percentChange(current, previous)} />}
    </span>
  </div>
)

interface PlacesCardViewProps {
  config: PlacesCardConfig
  data: PlacesCardData | null
  loading?: boolean
}

const Body = ({ data, loading }: { data: PlacesCardData | null; loading: boolean }) => {
  if (loading) {
    return (
      <div class="metric-value">
        <span class="loading-placeholder">...</span>
      </div>
    )
  }
  if (!data) {
    return (
      <div class="metric-value">
        <span class="no-data">No data</span>
      </div>
    )
  }
  const nightsByPlace = data.nights_by_place ?? []
  const previousNights = (name: string): number | undefined =>
    data.previous_nights_by_place && (data.previous_nights_by_place.find((p) => p.name === name)?.nights ?? 0)
  return (
    <>
      <div class="activity-type-card-rows">
        {nightsByPlace.map((place) => (
          <Figure
            key={place.name}
            label={`Nights ${place.name}`}
            current={place.nights}
            previous={previousNights(place.name)}
          />
        ))}
        {(data.nights_elsewhere > 0 || (data.previous_nights_elsewhere ?? 0) > 0) && (
          <Figure
            label="Nights elsewhere"
            current={data.nights_elsewhere}
            previous={data.previous_nights_elsewhere}
          />
        )}
        {data.nights_no_data > 0 && <Figure label="No location data" current={data.nights_no_data} />}
        <Figure label="Places" current={data.distinct_places} previous={data.previous_distinct_places} />
      </div>
      {data.places.length > 0 && (
        <ol class="top-list-card-items">
          {data.places.map((place) => (
            <li key={place.name} class="activity-type-card-row">
              <span class="activity-type-card-label top-list-card-name">{place.name}</span>
              <span class="activity-type-card-value">{formatNumber(place.hours)} h</span>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

export function PlacesCardView({ config, data, loading = false }: PlacesCardViewProps) {
  return (
    <div class="metric-card places-card">
      <div class="metric-header">
        <span class="metric-title">{config.title ?? 'Places'}</span>
      </div>
      <Body data={data} loading={loading} />
    </div>
  )
}

export function PlacesCardWidget({ config }: { config: PlacesCardConfig }) {
  const { home_location, lookback_days = 30 } = config

  const query = useQuery({
    queryFn: () => {
      const end = new Date()
      return fetchPlacesSummary({
        end: end.toISOString(),
        start: new Date(end.getTime() - lookback_days * DAY_MS).toISOString(),
        tz: browserTz,
        ...(home_location ? { home_location } : {}),
      })
    },
    queryKey: ['places-card', home_location, lookback_days],
    ...HEAVY_QUERY_OPTIONS,
    staleTime: 5 * 60 * 1000,
  })

  return <PlacesCardView config={config} data={query.data ?? null} loading={query.isLoading} />
}
