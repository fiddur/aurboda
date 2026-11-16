/**
 * Activity detail map — the data half: fetches the activity's stored track and
 * the raw GPS points in its span (see `pickActivityPoints`), and delegates the
 * rendering (polyline + hover-time highlight) to the shared `RouteMap` (also
 * used by the feed's native post cards).
 */
import { useQuery } from '@tanstack/react-query'

import type { IndexRange } from '../../utils/segmentCut'

import { RouteMap } from '../../components/charts/RouteMap'
import {
  fetchActivityTrack,
  fetchRawLocations,
  pickActivityPoints,
  type TimedGpsPoint,
} from '../../state/api'

const LOCATION_STALE_TIME_MS = 5 * 60_000 // 5 minutes

export interface ActivityPointsWindow {
  activityId?: string
  /** The activity's own start_time: the origin of its stored track's times. */
  activityStart: Date
  start: Date
  end: Date
}

export interface ActivityMapPoints {
  points: TimedGpsPoint[]
  /** The stored track's `t` per point when the map shows the stored track, else null (raw GPS). */
  track_offsets_s: number[] | null
}

const loadActivityPoints = async ({
  activityId,
  activityStart,
  start,
  end,
}: ActivityPointsWindow): Promise<ActivityMapPoints> => {
  const track = activityId ? await fetchActivityTrack(activityId, activityStart) : null
  const points = await pickActivityPoints(track, () => fetchRawLocations(start, end))
  return { points, track_offsets_s: track && points === track.points ? track.offsets_s : null }
}

/** The map's points; one query per activity span, shared by the map and the segment creator. */
export const useActivityMapPoints = (span: ActivityPointsWindow) =>
  useQuery({
    queryFn: () => loadActivityPoints(span),
    queryKey: ['activity-gps', span.activityId, span.start.toISOString(), span.end.toISOString()],
    staleTime: LOCATION_STALE_TIME_MS,
  })

interface ActivityMapProps extends ActivityPointsWindow {
  hoverTime: Date | null
  highlight?: IndexRange | null
}

export const ActivityMap = ({ hoverTime, highlight, ...span }: ActivityMapProps) => {
  const { data } = useActivityMapPoints(span)
  return <RouteMap points={data?.points ?? []} hoverTime={hoverTime} highlight={highlight} />
}
