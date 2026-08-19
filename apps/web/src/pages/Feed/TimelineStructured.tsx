/**
 * Native rendering of a timeline post's Aurboda structured data. An `activity`
 * post renders natively (#997): title, the author's personal message, the
 * activity's own date (#998), a Strava-style stat grid from the typed scalars,
 * and an interactive line chart per shared high-resolution series (hover shows
 * real values). An `article` post renders the full inline article (title +
 * resolved blocks — see `TimelineArticle`). Only rendered for posts from
 * Aurboda instances (which carry `structured`); Mastodon posts have none.
 */
import type { FeedStructuredPost } from '@aurboda/api-spec'

import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { formatEntryWindow } from './activity-stats'
import { ActivityStatGrid } from './ActivityStatGrid'
import { structuredChartSeries } from './timeline-structured'
import { TimelineArticle } from './TimelineArticle'
import './TimelineStructured.css'

export function TimelineStructured({ structured }: { structured: FeedStructuredPost }) {
  if (structured.kind === 'article') return <TimelineArticle article={structured} />

  const series = structuredChartSeries(structured)
  return (
    <div class="timeline-structured">
      <p class="feed-post-title">
        <strong>{structured.title ?? 'Shared activity'}</strong>
      </p>
      {structured.message && <p class="feed-post-message">{structured.message}</p>}
      <p class="feed-post-window">{formatEntryWindow(structured.start_time, structured.end_time)}</p>
      <ActivityStatGrid metrics={structured.metrics} />
      {series.map((s) => (
        <figure key={s.metric} class="timeline-chart">
          <figcaption class="timeline-chart-label">{s.label}</figcaption>
          <TrendLineChart data={s.data} color={s.color} height={170} />
        </figure>
      ))}
    </div>
  )
}
