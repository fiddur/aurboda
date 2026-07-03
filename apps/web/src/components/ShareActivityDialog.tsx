/**
 * Publish an activity to the user's federated feed (or edit an existing feed
 * post). The user picks which scalar summaries to share, optionally opts into
 * sharing full high-resolution series (a separate, more-revealing choice), and
 * sets the audience.
 *
 * Passing `post` switches the dialog to edit mode (PATCH); otherwise it shares
 * the activity (POST). Only the metric keys the backend can resolve are offered
 * — unavailable ones are silently dropped server-side, so the same set is safe
 * to show for every activity.
 */
import type { FeedPost, FeedVisibility, MetricType } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { fetchBucketedMetrics, fetchRawLocations, shareActivity, updateFeedPost } from '../state/api'
import { SERIES_METRICS, SUMMARY_METRICS } from './feed-metrics'
import './ShareActivityDialog.css'

interface Props {
  activityId: string
  activityTitle?: string
  /** Activity window — when given, the dialog offers only metrics with data in it. */
  activityStart?: Date
  activityEnd?: Date
  /** When present, edit this existing post instead of sharing anew. */
  post?: FeedPost
  onClose: () => void
  onShared?: (post: FeedPost) => void
}

const VISIBILITIES: { value: FeedVisibility; label: string; hint: string }[] = [
  { hint: 'Anyone can see it; appears in public timelines.', label: 'Public', value: 'public' },
  { hint: 'Anyone with the link; kept out of public timelines.', label: 'Unlisted', value: 'unlisted' },
  { hint: 'Only your followers.', label: 'Followers only', value: 'followers' },
]

const DEFAULT_SUMMARY = ['duration', 'distance', 'heart_rate_avg', 'heart_rate_max', 'calories']

const toggle = <T extends string>(set: Set<T>, key: T): Set<T> => {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/**
 * Which summary/series options to offer for an activity: those whose source
 * metric has data in the given window (e.g. no Distance on a yoga session),
 * plus `keepSummary`/`keepSeries` — metrics the post already shares, always kept
 * so an edit over a narrower window can never silently drop an existing choice.
 * One coarse bucketed fetch; while it loads (or without a window) every option
 * is offered.
 */
// eslint-disable-next-line complexity -- availability gating across summary/series/chart/map
const useShareableMetricOptions = (
  activityStart?: Date,
  activityEnd?: Date,
  keepSummary: string[] = [],
  keepSeries: string[] = [],
  keepChart = false,
  keepMap = false,
) => {
  const availabilityQuery = useQuery({
    // The `??` fallbacks never run — `enabled` gates the fetch on both being set.
    enabled: activityStart != null && activityEnd != null,
    queryFn: () =>
      fetchBucketedMetrics(activityStart ?? new Date(), activityEnd ?? new Date(), undefined, '1h'),
    queryKey: ['share-activity-metrics', activityStart?.toISOString(), activityEnd?.toISOString()],
    staleTime: 5 * 60 * 1000,
  })
  // The route map is rendered from actual GPS points, so gate its toggle on real
  // location data — not a distance/speed proxy (a treadmill run has those but no
  // GPS, and would otherwise attach a route.png that 404s).
  const locationsQuery = useQuery({
    enabled: activityStart != null && activityEnd != null,
    queryFn: () => fetchRawLocations(activityStart ?? new Date(), activityEnd ?? new Date()),
    queryKey: ['share-activity-locations', activityStart?.toISOString(), activityEnd?.toISOString()],
    staleTime: 5 * 60 * 1000,
  })
  const hasGps = (locationsQuery.data?.length ?? 0) > 0

  const present = availabilityQuery.data?.buckets
    ? new Set(availabilityQuery.data.buckets.flatMap((b) => Object.keys(b.metrics)))
    : undefined
  return {
    // The chart renders heart rate (a time-series metric, so presence is exact).
    // `keepChart`/`keepMap` keep an already-attached image toggleable when editing.
    canChart: present ? present.has('heart_rate') || keepChart : true,
    canMap: hasGps || keepMap,
    seriesOptions: present
      ? SERIES_METRICS.filter((m) => present.has(m.key) || keepSeries.includes(m.key))
      : SERIES_METRICS,
    summaryOptions: present
      ? SUMMARY_METRICS.filter(
          (m) => m.source === undefined || present.has(m.source) || keepSummary.includes(m.key),
        )
      : SUMMARY_METRICS,
  }
}

// eslint-disable-next-line complexity -- composite share/edit form (metrics, series, images, visibility)
export function ShareActivityDialog({
  activityId,
  activityTitle,
  activityStart,
  activityEnd,
  post,
  onClose,
  onShared,
}: Props) {
  const queryClient = useQueryClient()
  const [summary, setSummary] = useState<Set<string>>(
    () => new Set(post ? post.included_metrics : DEFAULT_SUMMARY),
  )
  // Preselect from the post's shared series, intersected with the keys this
  // dialog can represent — keeps the state typed as `Set<MetricType>` without a
  // cast (the dialog only offers `SERIES_METRICS` anyway).
  const [series, setSeries] = useState<Set<MetricType>>(
    () => new Set(SERIES_METRICS.map((m) => m.key).filter((k) => post?.series_metrics.includes(k) ?? false)),
  )
  const [visibility, setVisibility] = useState<FeedVisibility>(post?.visibility ?? 'public')
  const [includeChart, setIncludeChart] = useState(post?.include_chart ?? false)
  const [includeMap, setIncludeMap] = useState(post?.include_map ?? false)
  const { summaryOptions, seriesOptions, canChart, canMap } = useShareableMetricOptions(
    activityStart,
    activityEnd,
    post?.included_metrics,
    post?.series_metrics,
    post?.include_chart,
    post?.include_map,
  )

  const mutation = useMutation({
    mutationFn: () => {
      // Only send metrics the dialog actually offered (drops defaults hidden as
      // irrelevant); the backend still ignores any with no data. Attachments are
      // only requested when their toggle is offered (chart needs HR, map needs GPS).
      const body = {
        include_chart: canChart && includeChart,
        include_map: canMap && includeMap,
        included_metrics: summaryOptions.map((m) => m.key).filter((k) => summary.has(k)),
        series_metrics: seriesOptions.map((m) => m.key).filter((k) => series.has(k)),
        visibility,
      }
      return post ? updateFeedPost(post.id, body) : shareActivity(activityId, body)
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      onShared?.(result)
      onClose()
    },
  })

  return (
    <div class="share-dialog-backdrop" onClick={onClose}>
      <div class="share-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="share-dialog-header">
          <h2>{post ? 'Edit shared post' : 'Share to feed'}</h2>
          <button type="button" class="share-dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p class="share-dialog-subtitle">
          {post ? 'Editing' : 'Publish'} <strong>{activityTitle || 'this activity'}</strong>
          {post ? ' — followers get an update.' : ' to your federated feed.'}
        </p>

        <fieldset class="share-dialog-group">
          <legend>Summary metrics</legend>
          <div class="share-dialog-options">
            {summaryOptions.map(({ key, label }) => (
              <label key={key} class="share-dialog-checkbox">
                <input
                  type="checkbox"
                  checked={summary.has(key)}
                  onChange={() => setSummary((s) => toggle(s, key))}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {seriesOptions.length > 0 && (
          <fieldset class="share-dialog-group">
            <legend>Share full time-series</legend>
            <p class="share-dialog-note">
              Higher resolution — more revealing than a summary. Off by default.
            </p>
            <div class="share-dialog-options">
              {seriesOptions.map(({ key, label }) => (
                <label key={key} class="share-dialog-checkbox">
                  <input
                    type="checkbox"
                    checked={series.has(key)}
                    onChange={() => setSeries((s) => toggle(s, key))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {(canChart || canMap) && (
          <fieldset class="share-dialog-group">
            <legend>Images</legend>
            <div class="share-dialog-options">
              {canChart && (
                <label class="share-dialog-checkbox">
                  <input
                    type="checkbox"
                    checked={includeChart}
                    onChange={(e) => setIncludeChart((e.target as HTMLInputElement).checked)}
                  />
                  Heart-rate chart
                </label>
              )}
              {canMap && (
                <label class="share-dialog-checkbox">
                  <input
                    type="checkbox"
                    checked={includeMap}
                    onChange={(e) => setIncludeMap((e.target as HTMLInputElement).checked)}
                  />
                  Route map
                </label>
              )}
            </div>
          </fieldset>
        )}

        <fieldset class="share-dialog-group">
          <legend>Visibility</legend>
          {VISIBILITIES.map(({ value, label, hint }) => (
            <label key={value} class="share-dialog-radio">
              <input
                type="radio"
                name="visibility"
                checked={visibility === value}
                onChange={() => setVisibility(value)}
              />
              <span>
                <strong>{label}</strong>
                <span class="share-dialog-hint">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {mutation.error && (
          <p class="share-dialog-error">
            {mutation.error instanceof Error ? mutation.error.message : 'Failed to share'}
          </p>
        )}

        <div class="share-dialog-actions">
          <button type="button" class="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary"
            disabled={mutation.isPending || !summaryOptions.some((m) => summary.has(m.key))}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving…' : post ? 'Save changes' : 'Share'}
          </button>
        </div>
      </div>
    </div>
  )
}
