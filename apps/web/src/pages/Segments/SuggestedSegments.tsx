import type { SuggestedSegment } from '@aurboda/api-spec'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'preact/hooks'

import { RouteMap } from '../../components/charts/RouteMap'
import { dismissSuggestedSegment, promoteSuggestedSegment } from '../../state/api'
import { cumulativeDistancesM, densifyLine, indexRangeForKm } from '../../utils/segmentCut'
import { formatDistance } from '../EntityDetail/format-utils'
import { ActivityTypeName } from '../Routes/ActivityTypeName'
import { CreateSegmentForm } from './CreateSegmentForm'
import { formatPassedOn, lengthKm, promoteTrim } from './format'
import './style.css'

/** RouteMap draws a line from timed points; a suggested line has no times and is never hovered. */
const NO_TIME = new Date(0)

export const SUGGESTED_QUERY_KEY = ['segments', 'suggested']

interface KmCut {
  start: string
  end: string
}

const parseKm = (value: string): number => {
  const km = Number(value)
  return Number.isFinite(km) && km > 0 ? km : 0
}

function SuggestionCard({ suggestion }: { suggestion: SuggestedSegment }) {
  const queryClient = useQueryClient()
  const [cut, setCut] = useState<KmCut | null>(null)
  const mapPoints = useMemo(
    () => densifyLine(suggestion.points.map((p) => ({ ...p, time: NO_TIME }))),
    [suggestion.points],
  )
  const distancesM = useMemo(() => cumulativeDistancesM(mapPoints), [mapPoints])
  const maxKm = lengthKm(suggestion.length_m)

  const dismissMutation = useMutation({
    mutationFn: () => dismissSuggestedSegment(suggestion.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SUGGESTED_QUERY_KEY }),
  })

  const startKm = cut ? parseKm(cut.start) : 0
  const endKm = cut ? parseKm(cut.end) : maxKm
  const lengthM = Math.max(0, Math.min(endKm * 1000, suggestion.length_m) - startKm * 1000)
  const kmInput = (edge: keyof KmCut, label: string) =>
    cut && (
      <label class="segment-cut-km">
        {label}
        <input
          type="number"
          min={0}
          max={maxKm}
          step={0.1}
          value={cut[edge]}
          onInput={(e) => setCut({ ...cut, [edge]: (e.target as HTMLInputElement).value })}
        />
      </label>
    )

  return (
    <li class="suggested-segment-card">
      <RouteMap
        points={mapPoints}
        hoverTime={null}
        highlight={cut && indexRangeForKm(distancesM, startKm, endKm)}
      />
      <p class="suggested-segment-summary">
        {formatDistance(suggestion.length_m)} · <ActivityTypeName name={suggestion.activity_type} /> ·{' '}
        {formatPassedOn(suggestion.activity_count)}
        {suggestion.near_name && ` · near ${suggestion.near_name}`}
      </p>
      {cut ? (
        <div class="segment-create-panel">
          <div class="segment-cut-kms">
            {kmInput('start', 'From km')}
            {kmInput('end', 'To km')}
          </div>
          <CreateSegmentForm
            lengthM={lengthM}
            onCancel={() => setCut(null)}
            submit={(name) =>
              promoteSuggestedSegment(suggestion.id, {
                ...promoteTrim(suggestion.length_m, startKm, endKm),
                ...(name ? { name } : {}),
              })
            }
          />
        </div>
      ) : (
        <div class="suggested-segment-actions">
          <button
            type="button"
            class="btn-primary"
            onClick={() => setCut({ end: String(maxKm), start: '0' })}
          >
            Add as segment
          </button>
          <button
            type="button"
            class="btn-secondary"
            disabled={dismissMutation.isPending}
            onClick={() => dismissMutation.mutate()}
          >
            Dismiss
          </button>
        </div>
      )}
    </li>
  )
}

export function SuggestedSegments({ suggestions }: { suggestions: SuggestedSegment[] }) {
  if (suggestions.length === 0) return null
  return (
    <section class="suggested-segments">
      <h2>Suggested</h2>
      <p class="suggested-segments-intro">
        Stretches several of your activities pass the same way, on different routes.
      </p>
      <ul class="suggested-segments-list">
        {suggestions.map((suggestion) => (
          <SuggestionCard key={suggestion.id} suggestion={suggestion} />
        ))}
      </ul>
    </section>
  )
}
