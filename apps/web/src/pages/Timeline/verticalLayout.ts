import type { Column } from './types'

export type VerticalTrackId = Column | 'Metrics'

export interface VerticalTrackSpec {
  id: VerticalTrackId
  /** A fixed width in pixels; without it the track shares the width left over with the other flexible tracks. */
  width?: number
  minWidth?: number
}

export interface VerticalTrackSlot {
  id: VerticalTrackId
  x: number
  width: number
}

export const MUSIC_TRACK_WIDTH = 40
export const METRICS_TRACK_MIN_WIDTH = 72

const TRACK_ORDER: VerticalTrackId[] = ['Activity', 'Location', 'Music', 'Metrics', 'Comments']

export const verticalTrackSpecs = (
  itemColumns: readonly Column[],
  showMusic: boolean,
  showMetrics: boolean,
): VerticalTrackSpec[] =>
  TRACK_ORDER.flatMap((id): VerticalTrackSpec[] => {
    if (id === 'Music') return showMusic ? [{ id, width: MUSIC_TRACK_WIDTH }] : []
    if (id === 'Metrics') return showMetrics ? [{ id, minWidth: METRICS_TRACK_MIN_WIDTH }] : []
    return itemColumns.includes(id) ? [{ id }] : []
  })

export const layoutVerticalTracks = (
  tracks: readonly VerticalTrackSpec[],
  chartWidth: number,
): VerticalTrackSlot[] => {
  const fixedTotal = tracks.reduce((sum, t) => sum + (t.width ?? 0), 0)
  const flexible = tracks.filter((t) => t.width === undefined)
  const pinned = new Map<VerticalTrackId, number>()

  let share = 0
  for (;;) {
    const pinnedTotal = [...pinned.values()].reduce((sum, w) => sum + w, 0)
    const free = flexible.filter((t) => !pinned.has(t.id))
    share = free.length > 0 ? Math.max(0, (chartWidth - fixedTotal - pinnedTotal) / free.length) : 0
    const tooNarrow = free.filter((t) => (t.minWidth ?? 0) > share)
    if (tooNarrow.length === 0) break
    for (const t of tooNarrow) pinned.set(t.id, t.minWidth!)
  }

  let x = 0
  return tracks.map((t) => {
    const width = t.width ?? pinned.get(t.id) ?? share
    const slot = { id: t.id, width, x }
    x += width
    return slot
  })
}
