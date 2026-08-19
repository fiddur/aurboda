/**
 * Native rendering of a timeline post's Aurboda structured data. An `activity`
 * post renders natively (#997): title, the author's personal message, the
 * activity's own date (#998), a Strava-style stat grid from the typed scalars,
 * and — just like the activity detail view (#1011) — ONE combined multi-metric
 * chart with per-metric toggles plus a time-synced interactive map that marks
 * the position at the hovered chart time. An `article` post renders the full
 * inline article (title + resolved blocks — see `TimelineArticle`). Only
 * rendered for posts from Aurboda instances (which carry `structured`);
 * Mastodon posts have none.
 */
import type { FeedStructuredActivity, FeedStructuredPost } from '@aurboda/api-spec'

import { useState } from 'preact/hooks'

import { CombinedMetricChart } from '../../components/charts/CombinedMetricChart'
import { RouteMap } from '../../components/charts/RouteMap'
import { formatEntryWindow } from './activity-stats'
import { ActivityStatGrid } from './ActivityStatGrid'
import {
  structuredCombinedSeries,
  structuredHasNativeMap,
  structuredRoutePoints,
} from './timeline-structured'
import { TimelineArticle } from './TimelineArticle'
import './TimelineStructured.css'

function ActivityStructured({ structured }: { structured: FeedStructuredActivity }) {
  const [hoverTime, setHoverTime] = useState<Date | null>(null)
  const series = structuredCombinedSeries(structured)
  const showMap = structuredHasNativeMap(structured)

  return (
    <div class="timeline-structured">
      <p class="feed-post-title">
        <strong>{structured.title ?? 'Shared activity'}</strong>
      </p>
      {structured.message && <p class="feed-post-message">{structured.message}</p>}
      <p class="feed-post-window">{formatEntryWindow(structured.start_time, structured.end_time)}</p>
      <ActivityStatGrid metrics={structured.metrics} />
      {series.length > 0 && structured.end_time && (
        <div class="timeline-chart">
          <CombinedMetricChart
            series={series}
            start={new Date(structured.start_time)}
            end={new Date(structured.end_time)}
            onHoverTime={setHoverTime}
          />
        </div>
      )}
      {showMap && <RouteMap points={structuredRoutePoints(structured)} hoverTime={hoverTime} />}
    </div>
  )
}

export function TimelineStructured({ structured }: { structured: FeedStructuredPost }) {
  if (structured.kind === 'article') return <TimelineArticle article={structured} />
  return <ActivityStructured structured={structured} />
}
