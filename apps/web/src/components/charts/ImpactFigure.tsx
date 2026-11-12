import type { ImpactBucket, WindowEffect } from '@aurboda/api-spec'

import { impactEffectSummary } from '@aurboda/api-spec'

import type { BaselineData } from '../../state/api'

import { IMPACT_METRICS, type ImpactMetric } from './impactMetrics'
import { ImpactTimelineChart } from './ImpactTimelineChart'
import './ImpactFigure.css'

export interface ImpactFigureData {
  timeline: ImpactBucket[]
  hrv_effect: WindowEffect
  hr_effect: WindowEffect
  stress_effect: WindowEffect
  occurrences: number
}

const SUMMARY_LABELS: Record<ImpactMetric, string> = { hr: 'Heart rate', hrv: 'HRV', stress: 'Stress' }

const LEGEND_LABELS: Record<ImpactMetric, string> = {
  hr: 'Heart Rate',
  hrv: 'HRV (higher is generally better)',
  stress: 'Stress',
}

/** The impact chart with its before → after effect lines and legend, as Analyze and an article show it. */
export function ImpactFigure({
  data,
  baseline,
  metrics = IMPACT_METRICS,
}: {
  data: ImpactFigureData
  baseline?: BaselineData | null
  metrics?: readonly ImpactMetric[]
}) {
  const shown = IMPACT_METRICS.filter((m) => metrics.includes(m))
  const effects: Record<ImpactMetric, WindowEffect> = {
    hr: data.hr_effect,
    hrv: data.hrv_effect,
    stress: data.stress_effect,
  }
  return (
    <>
      <ImpactTimelineChart timeline={data.timeline} baseline={baseline} metrics={metrics} />
      <ul class="impact-summary">
        {shown.map((m) => {
          const line = impactEffectSummary(SUMMARY_LABELS[m], effects[m], data.occurrences)
          return line && <li key={m}>{line}</li>
        })}
      </ul>
      <div class="impact-legend">
        {shown.map((m) => (
          <span key={m}>
            <span class={`impact-dot ${m}`} /> {LEGEND_LABELS[m]}
          </span>
        ))}
        <span>
          <span class="impact-zone" /> Activity period
        </span>
      </div>
    </>
  )
}
