/**
 * Native rendering of a timeline post's Aurboda structured data: an interactive
 * line chart per shared high-resolution series (hover shows real values) instead
 * of a static image or plain text. Only rendered for posts from Aurboda
 * instances (which carry `structured`); Mastodon posts have none.
 */
import type { FeedStructured } from '@aurboda/api-spec'

import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { structuredChartSeries } from './timeline-structured'
import './TimelineStructured.css'

export function TimelineStructured({ structured }: { structured: FeedStructured }) {
  const series = structuredChartSeries(structured)
  if (series.length === 0) return null
  return (
    <div class="timeline-structured">
      {series.map((s) => (
        <figure key={s.metric} class="timeline-chart">
          <figcaption class="timeline-chart-label">{s.label}</figcaption>
          <TrendLineChart data={s.data} color={s.color} height={170} />
        </figure>
      ))}
    </div>
  )
}
