import type { ImpactBucket, WindowEffect } from '@aurboda/api-spec'

import { impactEffectSummary } from '@aurboda/api-spec'

import type { BaselineData } from '../../state/api'

import { ImpactTimelineChart } from './ImpactTimelineChart'
import './ImpactFigure.css'

export interface ImpactFigureData {
  timeline: ImpactBucket[]
  hrv_effect: WindowEffect
  hr_effect: WindowEffect
  stress_effect: WindowEffect
  occurrences: number
}

/** The impact chart with its before → after effect lines and legend, as Analyze and an article show it. */
export function ImpactFigure({ data, baseline }: { data: ImpactFigureData; baseline?: BaselineData | null }) {
  return (
    <>
      <ImpactTimelineChart timeline={data.timeline} baseline={baseline} />
      <ul class="impact-summary">
        {(
          [
            ['HRV', data.hrv_effect],
            ['Heart rate', data.hr_effect],
            ['Stress', data.stress_effect],
          ] as const
        ).map(([label, effect]) => {
          const line = impactEffectSummary(label, effect, data.occurrences)
          return line && <li key={label}>{line}</li>
        })}
      </ul>
      <div class="impact-legend">
        <span>
          <span class="impact-dot hrv" /> HRV (higher is generally better)
        </span>
        <span>
          <span class="impact-dot hr" /> Heart Rate
        </span>
        <span>
          <span class="impact-dot stress" /> Stress
        </span>
        <span>
          <span class="impact-zone" /> Activity period
        </span>
      </div>
    </>
  )
}
