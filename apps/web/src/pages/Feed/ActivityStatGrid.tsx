/**
 * Native Strava-style stat display for a shared activity (#997): each shared
 * scalar as a big-value/small-label cell, with HR-zone minutes as their own
 * compact row. Renders from the typed metrics (`FeedPost.metrics` on the
 * owner's own card / public profile, `FeedStructuredActivity.metrics` on a peer
 * timeline) — presentation only, no data fetch.
 */
import type { FeedStructuredMetric } from '@aurboda/api-spec'

import { splitStats } from './activity-stats'
import './ActivityStatGrid.css'

export function ActivityStatGrid({ metrics }: { metrics: readonly FeedStructuredMetric[] }) {
  const { cells, zones } = splitStats(metrics)
  if (cells.length === 0 && zones.length === 0) return null
  return (
    <div class="activity-stat-grid">
      {cells.length > 0 && (
        <div class="activity-stat-cells">
          {cells.map((cell) => (
            <div key={cell.key} class="activity-stat">
              <span class="activity-stat-value">{cell.value}</span>
              <span class="activity-stat-label">{cell.label}</span>
            </div>
          ))}
        </div>
      )}
      {zones.length > 0 && (
        <div class="activity-stat-zones">
          <span class="activity-stat-label">HR zones</span>
          {zones.map((zone) => (
            <span key={zone.zone} class="activity-stat-zone">
              <strong>{zone.zone}</strong> {zone.minutes}m
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
