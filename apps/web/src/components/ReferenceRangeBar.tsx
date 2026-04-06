import type { ReportFlag } from '@aurboda/api-spec'

import './ReferenceRangeBar.css'

interface ReferenceRangeBarProps {
  value: number
  reference_low?: number
  reference_high?: number
  flag?: ReportFlag
}

const FLAG_COLORS: Record<string, string> = {
  critical_high: '#dc2626',
  critical_low: '#dc2626',
  high: '#f59e0b',
  low: '#f59e0b',
  normal: '#22c55e',
}

/**
 * Horizontal bar visualizing where a value falls relative to its reference range.
 * Shows low/normal/high zones with a marker for the actual value.
 */
export function ReferenceRangeBar({ value, reference_low, reference_high, flag }: ReferenceRangeBarProps) {
  if (reference_low === undefined && reference_high === undefined) {
    return null
  }

  // Calculate display range: extend 30% beyond reference bounds
  const low = reference_low ?? reference_high! - Math.abs(reference_high!) * 0.5
  const high = reference_high ?? reference_low! + Math.abs(reference_low!) * 0.5
  const span = high - low
  const padding = span * 0.3
  const displayMin = low - padding
  const displayMax = high + padding
  const displaySpan = displayMax - displayMin

  // Position calculations as percentages
  const lowPct = ((low - displayMin) / displaySpan) * 100
  const highPct = ((high - displayMin) / displaySpan) * 100
  const valuePct = Math.max(0, Math.min(100, ((value - displayMin) / displaySpan) * 100))

  const markerColor = flag ? (FLAG_COLORS[flag] ?? '#6b7280') : '#6b7280'

  return (
    <div
      class="ref-range-bar"
      title={`Value: ${value}, Range: ${reference_low ?? '—'}–${reference_high ?? '—'}`}
    >
      <div class="ref-range-track">
        {/* Warning zones */}
        <div class="ref-range-zone ref-range-low" style={{ left: 0, width: `${lowPct}%` }} />
        <div
          class="ref-range-zone ref-range-high"
          style={{ left: `${highPct}%`, width: `${100 - highPct}%` }}
        />
        {/* Normal zone */}
        <div
          class="ref-range-zone ref-range-normal"
          style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }}
        />
        {/* Value marker */}
        <div class="ref-range-marker" style={{ backgroundColor: markerColor, left: `${valuePct}%` }} />
      </div>
      <div class="ref-range-labels">
        {reference_low !== undefined && <span class="ref-range-label-low">{reference_low}</span>}
        <span class="ref-range-label-spacer" />
        {reference_high !== undefined && <span class="ref-range-label-high">{reference_high}</span>}
      </div>
    </div>
  )
}
