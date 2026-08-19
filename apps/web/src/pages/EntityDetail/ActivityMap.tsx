/**
 * Activity detail map — the data half: fetches the raw GPS points for the
 * activity window and delegates the rendering (polyline + hover-time highlight)
 * to the shared `RouteMap` (also used by the feed's native post cards).
 */
import { useQuery } from '@tanstack/react-query'

import { RouteMap } from '../../components/charts/RouteMap'
import { fetchRawLocations } from '../../state/api'

const LOCATION_STALE_TIME_MS = 5 * 60_000 // 5 minutes

interface ActivityMapProps {
  start: Date
  end: Date
  hoverTime: Date | null
}

export const ActivityMap = ({ start, end, hoverTime }: ActivityMapProps) => {
  const { data: points } = useQuery({
    queryFn: () => fetchRawLocations(start, end),
    queryKey: ['raw-locations', start.toISOString(), end.toISOString()],
    staleTime: LOCATION_STALE_TIME_MS,
  })

  return <RouteMap points={points ?? []} hoverTime={hoverTime} />
}
