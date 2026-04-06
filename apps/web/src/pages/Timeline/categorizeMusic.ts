import { format } from 'date-fns'

import type { Scrobble } from '../../state/api'
import type { ChartItem } from './types'

const MUSIC_COLOR = '#ec4899'
const TRACK_DURATION_MS = 3.5 * 60 * 1000 // ~3.5 minutes

const formatTime = (date: Date): string => format(date, 'HH:mm')

export const categorizeMusic = (scrobbles: Scrobble[]): ChartItem[] =>
  scrobbles.map((s) => {
    const label = `${s.artist} – ${s.track}`
    const end = new Date(s.recorded_at.getTime() + TRACK_DURATION_MS)
    return {
      color: MUSIC_COLOR,
      column: 'Music',
      end,
      isPoint: false,
      label,
      start: s.recorded_at,
      tooltip: {
        details: [s.album].filter(Boolean),
        time: formatTime(s.recorded_at),
        title: label,
      },
    }
  })
