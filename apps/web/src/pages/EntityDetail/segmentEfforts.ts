import type { ActivitySegmentEffort } from '@aurboda/api-spec'

import { formatPace } from './format-utils'

export interface SegmentEffortRow {
  key: string
  name: string
  segment_id: string
  time: string
  pace?: string
  avg_hr?: string
  best: boolean
  approximate: boolean
}

/** Seconds as m:ss (h:mm:ss from an hour). */
export const formatElapsed = (seconds: number): string => {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = (total % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`
}

export const segmentEffortRows = (efforts: ActivitySegmentEffort[] | undefined): SegmentEffortRow[] =>
  (efforts ?? []).map((effort) => ({
    approximate: effort.approximate,
    ...(effort.avg_hr === null ? {} : { avg_hr: `${Math.round(effort.avg_hr)} bpm` }),
    best: effort.is_best,
    key: `${effort.segment_id}:${effort.start_offset_s}`,
    name: effort.segment_name,
    segment_id: effort.segment_id,
    ...(formatPace(effort.pace_s_per_km) ? { pace: formatPace(effort.pace_s_per_km) } : {}),
    time: formatElapsed(effort.elapsed_s),
  }))
