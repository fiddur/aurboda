/**
 * Activity detail map — the data half: fetches the activity's stored track, or
 * the raw GPS points in its window when it has none, and delegates the
 * rendering (polyline + hover-time highlight) to the shared `RouteMap` (also
 * used by the feed's native post cards).
 */
import { useQuery } from '@tanstack/react-query'

import { RouteMap } from '../../components/charts/RouteMap'
import { fetchActivityTrack, fetchRawLocations } from '../../state/api'

const LOCATION_STALE_TIME_MS = 5 * 60_000 // 5 minutes

interface ActivityMapProps {
  activityId?: string
  /** The activity's own start_time: the origin of its stored track's times. */
  activityStart: Date
  start: Date
  end: Date
  hoverTime: Date | null
}

const loadActivityPoints = async (
  activityId: string | undefined,
  activityStart: Date,
  start: Date,
  end: Date,
): Promise<{ lat: number; lon: number; time: Date }[]> =>
  (activityId ? await fetchActivityTrack(activityId, activityStart) : null) ??
  (await fetchRawLocations(start, end))

export const ActivityMap = ({ activityId, activityStart, start, end, hoverTime }: ActivityMapProps) => {
  const { data: points } = useQuery({
    queryFn: () => loadActivityPoints(activityId, activityStart, start, end),
    queryKey: ['activity-gps', activityId, start.toISOString(), end.toISOString()],
    staleTime: LOCATION_STALE_TIME_MS,
  })

  return <RouteMap points={points ?? []} hoverTime={hoverTime} />
}
