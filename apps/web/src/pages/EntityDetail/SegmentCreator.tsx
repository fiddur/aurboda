import { useMemo, useState } from 'preact/hooks'

import {
  cumulativeDistancesM,
  cutBounds,
  cutLengthM,
  type IndexRange,
  indexRangeForOffsets,
  moveCutEdge,
} from '../../utils/segmentCut'
import { formatElapsed } from '../Routes/format'
import { CreateSegmentForm } from '../Segments/CreateSegmentForm'
import { ActivityMap, type ActivityPointsWindow, useActivityMapPoints } from './ActivityMap'

interface Cut {
  start: number
  end: number
}

type Bounds = { min: number; max: number }

const initialCut = ({ min, max }: Bounds): Cut => {
  const third = (max - min) / 3
  return { end: Math.round(min + 2 * third), start: Math.round(min + third) }
}

interface CutPanelProps {
  activityId: string
  offsetsS: number[]
  distancesM: number[]
  bounds: Bounds
  cut: Cut
  onCutChange: (cut: Cut) => void
  onCancel: () => void
}

const CutPanel = ({
  activityId,
  offsetsS,
  distancesM,
  bounds,
  cut,
  onCutChange,
  onCancel,
}: CutPanelProps) => {
  const lengthM = cutLengthM(distancesM, indexRangeForOffsets(offsetsS, cut.start, cut.end))
  const slider = (edge: 'start' | 'end', label: string) => (
    <label class="segment-cut-slider">
      <span>
        {label} <span class="segment-cut-time">{formatElapsed(cut[edge])}</span>
      </span>
      <input
        type="range"
        min={bounds.min}
        max={bounds.max}
        step={1}
        value={cut[edge]}
        onInput={(e) =>
          onCutChange(moveCutEdge(cut, edge, Number((e.target as HTMLInputElement).value), bounds))
        }
      />
    </label>
  )
  return (
    <div class="segment-create-panel">
      {slider('start', 'Start')}
      {slider('end', 'End')}
      <CreateSegmentForm
        cut={{ activity_id: activityId, end_offset_s: cut.end, start_offset_s: cut.start }}
        lengthM={lengthM}
        durationS={cut.end - cut.start}
        onCancel={onCancel}
      />
    </div>
  )
}

interface ActivityMapWithSegmentCreatorProps extends ActivityPointsWindow {
  hoverTime: Date | null
  /** Offer "Create segment" (not while editing or for a deleted activity). */
  canCreate: boolean
}

/**
 * The activity map with "Create segment": two sliders over the stored track's
 * time pick the stretch, highlighted on the map. Offered only when the map shows
 * the stored track, since the cut's offsets are that track's `t`.
 */
export const ActivityMapWithSegmentCreator = ({
  hoverTime,
  canCreate,
  ...span
}: ActivityMapWithSegmentCreatorProps) => {
  const { data } = useActivityMapPoints(span)
  const [cut, setCut] = useState<Cut | null>(null)
  const offsetsS = data?.track_offsets_s ?? null
  const points = data?.points
  const distancesM = useMemo(() => (points ? cumulativeDistancesM(points) : []), [points])
  const activityId = span.activityId?.replace(/^merged:/, '')
  const bounds = canCreate && activityId ? cutBounds(offsetsS) : null
  const panel = bounds && cut && offsetsS && activityId ? { activityId, bounds, cut, offsetsS } : null
  const highlight: IndexRange | null = panel
    ? indexRangeForOffsets(panel.offsetsS, panel.cut.start, panel.cut.end)
    : null

  return (
    <>
      <ActivityMap {...span} hoverTime={hoverTime} highlight={highlight} />
      {bounds && !panel && (
        <div class="segment-create-open">
          <button type="button" class="btn-secondary" onClick={() => setCut(initialCut(bounds))}>
            Create segment
          </button>
        </div>
      )}
      {panel && (
        <CutPanel {...panel} distancesM={distancesM} onCutChange={setCut} onCancel={() => setCut(null)} />
      )}
    </>
  )
}
